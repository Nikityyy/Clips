import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, protocol, screen, shell } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { promises as fs, createReadStream, existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { DatabaseStore } from './database';
import { IPC_CHANNELS, IpcSchema, toAssetUri } from '../src/shared/contracts';
import type {
  AppSnapshot,
  Asset,
  AssetKind,
  AssetSource,
  Character,
  CreateCharacterInput,
  EntityId,
  ErrorCode,
  FlowImportInput,
  GenerationDraft,
  GenerationJob,
  GenerationRequest,
  ImageToVideoRequest,
  ImportIssue,
  ImportSummary,
  JobKind,
  JobStatus,
  Locale,
  NativeMenuAction,
  ProviderAccount,
  ProviderCapabilities,
  Result,
  Settings,
  SettingsPatch,
  StorageSummary,
  UpdateCharacterInput,
} from '../src/shared/contracts';

type Row = Record<string, unknown>;
type SavedWindowState = { x: number; y: number; width: number; height: number; maximized: boolean };
type MenuCopy = {
  app: string; about: string; services: string; hide: string; hideOthers: string; showAll: string; quit: string;
  file: string; importMedia: string; settings: string; closeWindow: string; edit: string; view: string;
  create: string; characters: string; images: string; videos: string; library: string; queue: string;
  fullScreen: string; reload: string; developerTools: string; window: string; minimize: string; zoom: string;
  front: string; help: string; helpLink: string; addToDictionary: string;
};
const MENU_COPY: Record<Locale, MenuCopy> = {
  en: {
    app: 'Clips', about: 'About Clips', services: 'Services', hide: 'Hide Clips', hideOthers: 'Hide Others', showAll: 'Show All', quit: 'Quit Clips',
    file: 'File', importMedia: 'Import media…', settings: 'Settings…', closeWindow: 'Close window', edit: 'Edit', view: 'View',
    create: 'Create', characters: 'Characters', images: 'Images', videos: 'Videos', library: 'Library', queue: 'Queue',
    fullScreen: 'Toggle full screen', reload: 'Reload', developerTools: 'Developer tools', window: 'Window', minimize: 'Minimize', zoom: 'Zoom',
    front: 'Bring all to front', help: 'Help', helpLink: 'Clips help and updates', addToDictionary: 'Add to dictionary',
  },
  de: {
    app: 'Clips', about: 'Über Clips', services: 'Dienste', hide: 'Clips ausblenden', hideOthers: 'Andere ausblenden', showAll: 'Alle einblenden', quit: 'Clips beenden',
    file: 'Datei', importMedia: 'Medien importieren…', settings: 'Einstellungen…', closeWindow: 'Fenster schließen', edit: 'Bearbeiten', view: 'Ansicht',
    create: 'Erstellen', characters: 'Figuren', images: 'Bilder', videos: 'Videos', library: 'Bibliothek', queue: 'Warteschlange',
    fullScreen: 'Vollbild umschalten', reload: 'Neu laden', developerTools: 'Entwicklertools', window: 'Fenster', minimize: 'Minimieren', zoom: 'Zoomen',
    front: 'Alle Fenster nach vorn', help: 'Hilfe', helpLink: 'Clips Hilfe und Updates', addToDictionary: 'Zum Wörterbuch hinzufügen',
  },
};
type ImportContext = {
  source: AssetSource;
  provider: 'mock' | 'google-flow' | null;
  accountId: EntityId | null;
  prompt: string | null;
  modelId: string | null;
  sourceAssetIds: EntityId[];
  characterId: EntityId | null;
};

class ClipsError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'ClipsError';
  }
}

const FLOW_URL = 'https://labs.google/fx/tools/flow';
const DEFAULT_ACCOUNT_ID = 'mock-default';
const MAX_FILES_PER_IMPORT = 20;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 750 * 1024 * 1024;
const MAX_IMPORT_BATCH_BYTES = 1024 * 1024 * 1024;
const MOCK_JOB_DURATION_MS = 2400;
const MOCK_IMAGE_MODEL_ID = 'mock-image';
const MOCK_VIDEO_MODEL_ID = 'mock-video';
const TRUSTED_NO_INPUT = z.undefined();

const capabilities: ProviderCapabilities = {
  provider: 'mock',
  label: 'Local mock provider',
  detail: 'Deterministic sample outputs. No Google account or Flow credits are used.',
  models: [
    {
      id: MOCK_IMAGE_MODEL_ID,
      label: 'Portrait study',
      kind: 'image',
      description: 'Creates a local sample contact sheet from the bundled portrait fixtures.',
      supportsReferences: true,
      supportsCharacter: true,
      creditCost: 0,
    },
    {
      id: MOCK_VIDEO_MODEL_ID,
      label: 'Motion study',
      kind: 'video',
      description: 'Creates a local sample clip from the bundled video fixture.',
      supportsReferences: true,
      supportsCharacter: true,
      creditCost: 0,
    },
  ],
  supportsImageToVideo: true,
  creditCost: 0,
};

const defaultDraft = (mode: JobKind): GenerationDraft => ({
  prompt: '',
  characterId: null,
  referenceAssetIds: [],
  modelId: mode === 'image' ? MOCK_IMAGE_MODEL_ID : MOCK_VIDEO_MODEL_ID,
  aspectRatio: mode === 'image' ? '2:3' : '16:9',
  outputCount: mode === 'image' ? 4 : 1,
  sourceImageId: null,
});

const makeDefaultSettings = (): Settings => ({
  locale: 'en',
  activeAccountId: DEFAULT_ACCOUNT_ID,
  imageModelId: MOCK_IMAGE_MODEL_ID,
  videoModelId: MOCK_VIDEO_MODEL_ID,
  imageAspectRatio: '2:3',
  videoAspectRatio: '16:9',
  outputCount: 4,
  drafts: { image: defaultDraft('image'), video: defaultDraft('video') },
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'clips-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let store: DatabaseStore | null = null;
let mediaDirectory = '';
let windowStatePath = '';
let savedWindowState: SavedWindowState | null = null;
let windowStateWrite: Promise<void> = Promise.resolve();
let windowStateTimer: ReturnType<typeof setTimeout> | null = null;
let menuLocale: Locale = 'en';
let snapshotRevision = 0;
const scheduledJobs = new Set<EntityId>();

function mustStore(): DatabaseStore {
  if (!store) throw new ClipsError('STORAGE_ERROR', 'Clips storage is still starting. Try again in a moment.');
  return store;
}

function text(row: Row, key: string, fallback = ''): string {
  const value = row[key];
  return typeof value === 'string' ? value : fallback;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function numberValue(row: Row, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === 'number' ? value : fallback;
}

function nullableNumber(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' ? value : null;
}

function jsonArray<T>(value: unknown): T[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeTitle(raw: string, fallback: string): string {
  const cleaned = [...raw].filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127;
  }).join('').trim().slice(0, 140);
  return cleaned || fallback;
}

function errorResult(error: unknown): Result<never> {
  if (error instanceof ClipsError) return { ok: false, error: { code: error.code, message: error.message } };
  if (error instanceof z.ZodError) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Those details are not valid.' } };
  console.error('[Clips] An internal operation failed.');
  return { ok: false, error: { code: 'INTERNAL', message: 'Clips could not complete that action. Your saved work is still here.' } };
}

function result<T>(data: T): Result<T> {
  return { ok: true, data };
}

function trustedRendererUrl(rawUrl: string, allowSubpath = true): boolean {
  try {
    const url = new URL(rawUrl);
    if (!app.isPackaged) return url.origin === 'http://localhost:3000';
    if (url.protocol !== 'file:') return false;
    const loadedPath = path.resolve(fileURLToPath(url));
    const outputRoot = path.resolve(app.getAppPath(), 'out');
    return loadedPath === path.join(outputRoot, 'index.html') ||
      (allowSubpath && loadedPath.startsWith(`${outputRoot}${path.sep}`));
  } catch {
    return false;
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!mainWindow || !frame || event.sender !== mainWindow.webContents || frame !== event.sender.mainFrame) {
    throw new ClipsError('PERMISSION_DENIED', 'This action is only available inside Clips.');
  }
  if (!trustedRendererUrl(frame.url)) {
    throw new ClipsError('PERMISSION_DENIED', 'This action is only available inside Clips.');
  }
}

function handle<Input, Output>(
  channel: string,
  schema: z.ZodType<Input>,
  action: (input: Input) => Promise<Output> | Output,
): void {
  ipcMain.handle(channel, async (event, rawInput) => {
    try {
      assertTrustedSender(event);
      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) return { ok: false, error: { code: 'INVALID_INPUT', message: 'Those details are not valid.' } };
      return result(await action(parsed.data));
    } catch (error) {
      return errorResult(error);
    }
  });
}

function activeSettings(): Settings {
  const raw = mustStore().setting<unknown>('app', makeDefaultSettings());
  const saved = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  const base = makeDefaultSettings();
  const accounts = mustStore().all('SELECT id FROM accounts');
  const validAccountIds = new Set(accounts.map((row) => text(row, 'id')));
  const savedActiveAccountId = typeof saved.activeAccountId === 'string' ? saved.activeAccountId : DEFAULT_ACCOUNT_ID;
  if (!validAccountIds.has(savedActiveAccountId)) saved.activeAccountId = DEFAULT_ACCOUNT_ID;
  return {
    ...base,
    ...saved,
    activeAccountId: saved.activeAccountId ?? savedActiveAccountId,
    drafts: {
      image: { ...base.drafts.image, ...saved.drafts?.image },
      video: { ...base.drafts.video, ...saved.drafts?.video },
    },
  };
}

function accountFromRow(row: Row): ProviderAccount {
  return {
    id: text(row, 'id'),
    provider: text(row, 'provider') === 'google-flow' ? 'google-flow' : 'mock',
    label: text(row, 'label'),
    connection: text(row, 'connection') === 'browser-handoff' ? 'browser-handoff' : 'mock-ready',
    createdAt: text(row, 'created_at'),
  };
}

function jobFromRow(row: Row): GenerationJob {
  const status = text(row, 'status', 'queued') as JobStatus;
  return {
    id: text(row, 'id'),
    kind: text(row, 'kind') === 'video' ? 'video' : 'image',
    status,
    progress: numberValue(row, 'progress'),
    stage: text(row, 'stage'),
    prompt: text(row, 'prompt'),
    characterId: nullableText(row, 'character_id'),
    inputAssetIds: jsonArray<EntityId>(row.input_asset_ids),
    outputAssetIds: jsonArray<EntityId>(row.output_asset_ids),
    modelId: text(row, 'model_id'),
    aspectRatio: text(row, 'aspect_ratio'),
    outputCount: numberValue(row, 'output_count', 1),
    accountId: nullableText(row, 'account_id'),
    provider: 'mock',
    error: nullableText(row, 'error'),
    retryOfJobId: nullableText(row, 'retry_of_job_id'),
    createdAt: text(row, 'created_at'),
    startedAt: nullableText(row, 'started_at'),
    completedAt: nullableText(row, 'completed_at'),
    progressStartedAt: nullableNumber(row, 'progress_started_at'),
  };
}

function assetFromRow(row: Row): Asset {
  const id = text(row, 'id');
  const db = mustStore();
  const linkedCharacters = db.all('SELECT character_id FROM asset_characters WHERE asset_id = ?', [id]).map((item) => text(item, 'character_id'));
  const referencedByCharacters = db.all('SELECT character_id FROM character_references WHERE asset_id = ?', [id]).map((item) => text(item, 'character_id'));
  return {
    id,
    kind: text(row, 'kind') === 'video' ? 'video' : 'image',
    title: text(row, 'title'),
    fileName: text(row, 'file_name'),
    mimeType: text(row, 'mime_type'),
    sizeBytes: numberValue(row, 'size_bytes'),
    width: nullableNumber(row, 'width'),
    height: nullableNumber(row, 'height'),
    durationMs: nullableNumber(row, 'duration_ms'),
    uri: toAssetUri(id),
    createdAt: text(row, 'created_at'),
    deletedAt: nullableText(row, 'deleted_at'),
    provenance: {
      source: text(row, 'source') as AssetSource,
      provider: text(row, 'provider') === 'mock' || text(row, 'provider') === 'google-flow'
        ? text(row, 'provider') as 'mock' | 'google-flow'
        : null,
      accountId: nullableText(row, 'account_id'),
      jobId: nullableText(row, 'job_id'),
      prompt: nullableText(row, 'prompt'),
      model: nullableText(row, 'model'),
      sourceAssetIds: jsonArray<EntityId>(row.source_asset_ids),
      characterIds: [...new Set([...linkedCharacters, ...referencedByCharacters])],
      createdAt: text(row, 'created_at'),
    },
  };
}

function characterFromRow(row: Row): Character {
  const id = text(row, 'id');
  const references = mustStore().all(
    'SELECT asset_id FROM character_references WHERE character_id = ? ORDER BY rowid',
    [id],
  ).map((item) => text(item, 'asset_id'));
  return {
    id,
    name: text(row, 'name'),
    description: text(row, 'description'),
    prompt: text(row, 'prompt'),
    portraitAssetId: nullableText(row, 'portrait_asset_id'),
    referenceAssetIds: references,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
  };
}

function getSnapshot(): AppSnapshot {
  const db = mustStore();
  const settings = activeSettings();
  return {
    revision: snapshotRevision,
    updatedAt: nowIso(),
    assets: db.all('SELECT * FROM assets WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC').map(assetFromRow),
    characters: db.all('SELECT * FROM characters ORDER BY updated_at DESC').map(characterFromRow),
    jobs: db.all('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC').map(jobFromRow),
    accounts: db.all('SELECT * FROM accounts ORDER BY created_at ASC, rowid ASC').map(accountFromRow),
    settings,
    capabilities,
    undoDeleteAvailable: Boolean(db.setting<string | null>('lastDeleteBatchId', null)),
  };
}

function publishSnapshot(): void {
  snapshotRevision += 1;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.snapshotUpdated, getSnapshot());
}

async function flushAndPublish(): Promise<void> {
  await mustStore().flush();
  publishSnapshot();
}

function validateExistingAssets(ids: EntityId[], kind?: AssetKind): void {
  const db = mustStore();
  for (const id of ids) {
    const row = db.one('SELECT id, kind FROM assets WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) throw new ClipsError('NOT_FOUND', 'One of the selected references is no longer in your library.');
    if (kind && text(row, 'kind') !== kind) throw new ClipsError('INVALID_INPUT', 'That reference type cannot be used here.');
  }
}

function validateCharacter(characterId: EntityId | null | undefined): void {
  if (!characterId) return;
  const exists = mustStore().one('SELECT id FROM characters WHERE id = ?', [characterId]);
  if (!exists) throw new ClipsError('NOT_FOUND', 'That character is no longer in your library.');
}

function associateCharacter(characterId: EntityId, assetIds: EntityId[]): void {
  const db = mustStore();
  db.run('DELETE FROM character_references WHERE character_id = ?', [characterId]);
  for (const assetId of new Set(assetIds)) {
    db.run('INSERT OR IGNORE INTO character_references (character_id, asset_id) VALUES (?, ?)', [characterId, assetId]);
  }
}

function mimeForFile(bytes: Uint8Array): { kind: AssetKind; mimeType: string; extension: string } | null {
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'image', mimeType: 'image/png', extension: 'png' };
  if (starts(0xff, 0xd8, 0xff)) return { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' };
  if (starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return { kind: 'image', mimeType: 'image/gif', extension: 'gif' };
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return { kind: 'image', mimeType: 'image/webp', extension: 'webp' };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', mimeType: 'image/avif', extension: 'avif' };
    if (brand === 'qt  ') return { kind: 'video', mimeType: 'video/quicktime', extension: 'mov' };
    return { kind: 'video', mimeType: 'video/mp4', extension: 'mp4' };
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', mimeType: 'video/webm', extension: 'webm' };
  return null;
}

async function sniffFile(filePath: string): Promise<{ kind: AssetKind; mimeType: string; extension: string; sizeBytes: number; width: number | null; height: number | null }> {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const stat = await fileHandle.stat();
    if (!stat.isFile()) throw new ClipsError('UNSUPPORTED_MEDIA', 'Choose an image or video file.');
    const header = Buffer.alloc(64);
    const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
    const media = mimeForFile(header.subarray(0, bytesRead));
    if (!media) throw new ClipsError('UNSUPPORTED_MEDIA', 'Clips supports PNG, JPEG, GIF, WebP, AVIF, MP4, MOV, and WebM files.');
    const limit = media.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    if (stat.size > limit) throw new ClipsError('FILE_TOO_LARGE', media.kind === 'image' ? 'Images must be 100 MB or smaller.' : 'Videos must be 750 MB or smaller.');
    if (stat.size < 12) throw new ClipsError('UNSUPPORTED_MEDIA', 'That file is too small to be a valid image or video.');
    const dimensions = await readDimensions(filePath, media.mimeType);
    return { ...media, sizeBytes: stat.size, ...dimensions };
  } finally {
    await fileHandle.close();
  }
}

async function readDimensions(filePath: string, mimeType: string): Promise<{ width: number | null; height: number | null }> {
  try {
    const fileHandle = await fs.open(filePath, 'r');
    try {
      if (mimeType === 'image/png') {
        const buffer = Buffer.alloc(24);
        await fileHandle.read(buffer, 0, buffer.length, 0);
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
      }
      if (mimeType === 'image/gif') {
        const buffer = Buffer.alloc(10);
        await fileHandle.read(buffer, 0, buffer.length, 0);
        return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
      }
      if (mimeType === 'image/webp') {
        const buffer = Buffer.alloc(30);
        await fileHandle.read(buffer, 0, buffer.length, 0);
        const chunk = buffer.toString('ascii', 12, 16);
        if (chunk === 'VP8X') return {
          width: 1 + buffer.readUIntLE(24, 3),
          height: 1 + buffer.readUIntLE(27, 3),
        };
      }
      if (mimeType === 'image/jpeg') {
        const buffer = Buffer.alloc(2 * 1024 * 1024);
        const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
        let offset = 2;
        while (offset + 9 < bytesRead) {
          if (buffer[offset] !== 0xff) { offset += 1; continue; }
          const marker = buffer[offset + 1];
          if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
          const segmentLength = buffer.readUInt16BE(offset + 2);
          if (segmentLength < 2 || offset + 2 + segmentLength > bytesRead) break;
          if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
            return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
          }
          offset += 2 + segmentLength;
        }
      }
    } finally {
      await fileHandle.close();
    }
  } catch {
    return { width: null, height: null };
  }
  return { width: null, height: null };
}

function mockDirectory(): string {
  if (process.env.CLIPS_TEST_USER_DATA && process.env.CLIPS_TEST_MEDIA_DIRECTORY) return path.resolve(process.env.CLIPS_TEST_MEDIA_DIRECTORY);
  if (app.isPackaged) return path.join(process.resourcesPath, 'media', 'mock');
  return path.resolve(__dirname, '..', '..', 'public', 'media', 'mock');
}

function canonicalStorageName(id: EntityId, extension: string): string {
  return `${id}.${extension}`;
}

function safeMediaPath(storageName: string): string {
  if (!storageName || path.basename(storageName) !== storageName || /[\\/\0]/.test(storageName)) {
    throw new ClipsError('STORAGE_ERROR', 'The saved file path is not valid.');
  }
  const candidate = path.resolve(mediaDirectory, storageName);
  if (path.dirname(candidate) !== path.resolve(mediaDirectory)) throw new ClipsError('STORAGE_ERROR', 'The saved file path is not valid.');
  return candidate;
}

async function copyIntoLibrary(sourcePath: string, context: ImportContext, explicitTitle?: string, remainingBatchBytes = Number.POSITIVE_INFINITY): Promise<Asset> {
  let realSource: string;
  try {
    realSource = await fs.realpath(sourcePath);
  } catch {
    throw new ClipsError('NOT_FOUND', 'That file can no longer be read.');
  }
  const media = await sniffFile(realSource);
  if (media.sizeBytes > remainingBatchBytes) throw new ClipsError('FILE_TOO_LARGE', 'This import batch is limited to 1 GB. Remove a file and try again.');
  const sourceName = path.basename(realSource);
  const id = randomUUID();
  const storageName = canonicalStorageName(id, media.extension);
  const destination = safeMediaPath(storageName);
  const temporary = `${destination}.tmp`;
  const createdAt = nowIso();
  const title = safeTitle(explicitTitle ?? path.basename(sourceName, path.extname(sourceName)), media.kind === 'image' ? 'Untitled image' : 'Untitled video');
  validateCharacter(context.characterId);
  validateExistingAssets(context.sourceAssetIds, 'image');
  let committed = false;
  try {
    await fs.copyFile(realSource, temporary);
    await fs.rename(temporary, destination);
    const db = mustStore();
    db.transaction(() => {
      db.run(`INSERT INTO assets (
        id, kind, title, file_name, storage_name, mime_type, size_bytes, width, height, duration_ms,
        source, provider, account_id, job_id, prompt, model, source_asset_ids, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`, [
        id, media.kind, title, sourceName.slice(0, 255), storageName, media.mimeType, media.sizeBytes,
        media.width, media.height, null, context.source, context.provider, context.accountId,
        context.prompt, context.modelId, JSON.stringify(context.sourceAssetIds), createdAt,
      ]);
      if (context.characterId) {
        db.run('INSERT OR IGNORE INTO asset_characters (asset_id, character_id) VALUES (?, ?)', [id, context.characterId]);
      }
    });
    committed = true;
    await db.flush();
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    if (!committed) await fs.rm(destination, { force: true }).catch(() => undefined);
    throw error;
  }
  const row = mustStore().one('SELECT * FROM assets WHERE id = ?', [id]);
  if (!row) throw new ClipsError('STORAGE_ERROR', 'The file was copied but could not be added to your library.');
  return assetFromRow(row);
}

function importContext(source: AssetSource = 'import'): ImportContext {
  return { source, provider: null, accountId: null, prompt: null, modelId: null, sourceAssetIds: [], characterId: null };
}

async function importPaths(paths: string[], context: ImportContext): Promise<ImportSummary> {
  if (paths.length > MAX_FILES_PER_IMPORT) throw new ClipsError('TOO_MANY_FILES', `Choose up to ${MAX_FILES_PER_IMPORT} files at a time.`);
  const imported: Asset[] = [];
  const rejected: ImportIssue[] = [];
  let importedBytes = 0;
  for (const sourcePath of paths) {
    const name = path.basename(sourcePath) || 'Dropped file';
    try {
      const asset = await copyIntoLibrary(sourcePath, context, undefined, MAX_IMPORT_BATCH_BYTES - importedBytes);
      imported.push(asset);
      importedBytes += asset.sizeBytes;
    } catch (error) {
      const mapped = errorResult(error);
      rejected.push({
        name: name.slice(0, 180),
        code: mapped.ok ? 'INTERNAL' : mapped.error.code,
        message: mapped.ok ? 'The file could not be imported.' : mapped.error.message,
      });
    }
  }
  if (imported.length > 0) publishSnapshot();
  return { imported, rejected };
}

function setAccountInSettings(accountId: EntityId): Settings {
  const db = mustStore();
  const settings = activeSettings();
  settings.activeAccountId = accountId;
  db.setSetting('app', settings);
  return settings;
}

async function seedLocalLibrary(): Promise<void> {
  const db = mustStore();
  if (db.one('SELECT id FROM accounts WHERE id = ?', [DEFAULT_ACCOUNT_ID]) === null) {
    db.run('INSERT INTO accounts (id, provider, label, connection, created_at) VALUES (?, ?, ?, ?, ?)', [
      DEFAULT_ACCOUNT_ID, 'mock', 'Local mock workspace', 'mock-ready', nowIso(),
    ]);
  }
  if (db.setting<Settings | null>('app', null) === null) db.setSetting('app', makeDefaultSettings());
  const settings = activeSettings();
  db.setSetting('app', settings);
  if (db.setting<boolean>('mockSeeded', false)) {
    await db.flush();
    return;
  }

  const fixturesPath = mockDirectory();
  const promptPath = path.join(fixturesPath, 'generation-prompt.txt');
  const fixtureNames = ['mara-01.png', 'mara-02.png', 'mara-03.png', 'mara-04.png', 'mara-05.png', 'mara-06.png'];
  let prompt = 'Fictional portrait study sample included with Clips.';
  try { prompt = await fs.readFile(promptPath, 'utf8'); } catch { /* Fixture files can be added after a clean build. */ }
  const ids: string[] = [];
  for (const [index, fileName] of fixtureNames.entries()) {
    const fixturePath = path.join(fixturesPath, fileName);
    if (!existsSync(fixturePath)) continue;
    try {
      const asset = await copyIntoLibrary(fixturePath, {
        source: 'mock', provider: 'mock', accountId: null, prompt, modelId: MOCK_IMAGE_MODEL_ID,
        sourceAssetIds: [], characterId: null,
      }, `Mara · ${String(index + 1).padStart(2, '0')}`);
      ids.push(asset.id);
    } catch (error) {
      console.warn(`[Clips] Could not install bundled sample ${fileName}:`, error instanceof Error ? error.message : 'unknown error');
      // A missing optional sample must not keep the rest of the library from opening.
    }
  }
  if (ids.length > 0) {
    const characterId = randomUUID();
    const now = nowIso();
    db.transaction(() => {
      db.run('INSERT INTO characters (id, name, description, prompt, portrait_asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        characterId,
        'Mara',
        'A fictional character from the included local sample set.',
        prompt,
        ids[0],
        now,
        now,
      ]);
      associateCharacter(characterId, ids);
      for (const assetId of ids) {
        db.run('INSERT OR IGNORE INTO asset_characters (asset_id, character_id) VALUES (?, ?)', [assetId, characterId]);
      }
    });
  }
  db.setSetting('mockSeeded', ids.length > 0);
  await db.flush();
}

function modelFor(id: string, kind: JobKind): void {
  const model = capabilities.models.find((candidate) => candidate.id === id);
  if (!model || model.kind !== kind) throw new ClipsError('INVALID_INPUT', 'Choose a model that supports this type of creation.');
}

function activeAccountIdForMock(): EntityId | null {
  const settings = activeSettings();
  const account = mustStore().one('SELECT * FROM accounts WHERE id = ?', [settings.activeAccountId]);
  if (!account || text(account, 'provider') !== 'mock') return null;
  return settings.activeAccountId;
}

function insertJob(args: {
  kind: JobKind;
  prompt: string;
  characterId: EntityId | null;
  inputAssetIds: EntityId[];
  modelId: string;
  aspectRatio: string;
  outputCount: number;
  retryOfJobId?: EntityId | null;
}): GenerationJob {
  const db = mustStore();
  const id = randomUUID();
  const createdAt = nowIso();
  const accountId = activeAccountIdForMock();
  db.run(`INSERT INTO jobs (
    id, kind, status, progress, stage, prompt, character_id, input_asset_ids, output_asset_ids,
    model_id, aspect_ratio, output_count, account_id, provider, error, retry_of_job_id,
    created_at, started_at, completed_at, progress_started_at
  ) VALUES (?, ?, 'queued', 0, 'Waiting to start', ?, ?, ?, '[]', ?, ?, ?, ?, 'mock', NULL, ?, ?, NULL, NULL, NULL)`, [
    id, args.kind, args.prompt, args.characterId, JSON.stringify(args.inputAssetIds), args.modelId,
    args.aspectRatio, args.outputCount, accountId, args.retryOfJobId ?? null, createdAt,
  ]);
  return jobFromRow(db.one('SELECT * FROM jobs WHERE id = ?', [id])!);
}

function startMockJob(jobId: EntityId): void {
  if (scheduledJobs.has(jobId)) return;
  scheduledJobs.add(jobId);
  void (async () => {
    const db = mustStore();
    try {
      let row = db.one('SELECT * FROM jobs WHERE id = ?', [jobId]);
      if (!row) return;
      let job = jobFromRow(row);
      if (job.status === 'queued') {
        const startedAt = nowIso();
        const timestamp = Date.now();
        db.run("UPDATE jobs SET status = 'running', progress = 1, stage = 'Preparing sample output', started_at = ?, progress_started_at = ? WHERE id = ?", [startedAt, timestamp, jobId]);
        await db.flush();
        publishSnapshot();
        row = db.one('SELECT * FROM jobs WHERE id = ?', [jobId]);
        if (!row) return;
        job = jobFromRow(row);
      }
      if (job.status !== 'running') return;
      const progressStartedAt = job.progressStartedAt ?? Date.now();
      let lastPublished = job.progress;
      while (true) {
        row = db.one('SELECT * FROM jobs WHERE id = ?', [jobId]);
        if (!row) return;
        job = jobFromRow(row);
        if (job.status !== 'running') return;
        const elapsed = Math.max(0, Date.now() - progressStartedAt);
        const progress = Math.min(94, Math.max(1, Math.floor((elapsed / MOCK_JOB_DURATION_MS) * 94)));
        const stage = progress < 38 ? 'Reading your prompt' : progress < 78 ? 'Preparing the sample' : 'Saving to your library';
        if (progress >= lastPublished + 5 || stage !== job.stage) {
          db.run('UPDATE jobs SET progress = ?, stage = ? WHERE id = ?', [progress, stage, jobId]);
          await db.flush();
          lastPublished = progress;
          publishSnapshot();
        }
        if (elapsed >= MOCK_JOB_DURATION_MS) break;
        await new Promise((resolve) => setTimeout(resolve, 160));
      }
      await completeMockJob(jobFromRow(db.one('SELECT * FROM jobs WHERE id = ?', [jobId])!));
    } catch (error) {
      const current = db.one('SELECT status FROM jobs WHERE id = ?', [jobId]);
      if (current && text(current, 'status') === 'running') {
        const message = error instanceof ClipsError ? error.message : 'The sample output could not be saved. Your prompt and references are still here.';
        db.run("UPDATE jobs SET status = 'failed', error = ?, stage = 'Could not save the sample', completed_at = ? WHERE id = ?", [
          message, nowIso(), jobId,
        ]);
        await db.flush().catch(() => undefined);
        publishSnapshot();
      }
    } finally {
      scheduledJobs.delete(jobId);
    }
  })();
}

async function completeMockJob(job: GenerationJob): Promise<void> {
  const db = mustStore();
  const fixtureRoot = mockDirectory();
  const fixtureFiles = job.kind === 'image'
    ? ['mara-01.png', 'mara-02.png', 'mara-03.png', 'mara-04.png', 'mara-05.png', 'mara-06.png']
    : ['mock-video.mp4'];
  const fixtureForOutput = fixtureFiles.filter((name) => existsSync(path.join(fixtureRoot, name)));
  if (fixtureForOutput.length === 0) throw new ClipsError('PROVIDER_UNAVAILABLE', 'The local mock sample files are missing.');
  const count = job.kind === 'video' ? 1 : Math.min(job.outputCount, fixtureForOutput.length);
  const outputIds: EntityId[] = [];
  const createdFiles: string[] = [];
  let committed = false;
  const promptLine = job.prompt.split(/[\r\n.!?]/, 1)[0].trim().slice(0, 68);
  try {
    for (let index = 0; index < count; index += 1) {
      const source = path.join(fixtureRoot, fixtureForOutput[index % fixtureForOutput.length]);
      const metadata = await sniffFile(source);
      const id = randomUUID();
      const storageName = canonicalStorageName(id, metadata.extension);
      const destination = safeMediaPath(storageName);
      const temporary = `${destination}.tmp`;
      await fs.copyFile(source, temporary);
      await fs.rename(temporary, destination);
      createdFiles.push(destination);
      outputIds.push(id);
    }

    const current = db.one('SELECT * FROM jobs WHERE id = ?', [job.id]);
    if (!current || text(current, 'status') !== 'running') {
      await Promise.all(createdFiles.map((file) => fs.rm(file, { force: true })));
      return;
    }
    const finishedAt = nowIso();
    db.transaction(() => {
      for (const [index, assetId] of outputIds.entries()) {
        const fixture = fixtureForOutput[index % fixtureForOutput.length];
        const media = mimeForFile(Buffer.from(readFileHeaderSync(path.join(fixtureRoot, fixture))));
        if (!media) throw new ClipsError('UNSUPPORTED_MEDIA', 'A bundled sample file is not valid media.');
        const sourceName = fixture;
        const storageName = canonicalStorageName(assetId, media.extension);
        const storedPath = safeMediaPath(storageName);
        const statResult = statSyncFor(storedPath);
        const dim = dimensionsForFixture(media.mimeType, statResult.width, statResult.height);
        db.run(`INSERT INTO assets (
          id, kind, title, file_name, storage_name, mime_type, size_bytes, width, height, duration_ms,
          source, provider, account_id, job_id, prompt, model, source_asset_ids, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mock', 'mock', ?, ?, ?, ?, ?, ?)`, [
          assetId, job.kind, job.kind === 'image' ? `${promptLine || 'Untitled image'} · ${index + 1}` : `${promptLine || 'Motion study'} · sample`,
          sourceName, storageName, media.mimeType, statResult.size, dim.width, dim.height,
          job.kind === 'video' ? 4000 : null, job.accountId, job.id, job.prompt, job.modelId,
          JSON.stringify(job.inputAssetIds), finishedAt,
        ]);
        if (job.characterId) {
          db.run('INSERT OR IGNORE INTO asset_characters (asset_id, character_id) VALUES (?, ?)', [assetId, job.characterId]);
        }
      }
      db.run("UPDATE jobs SET status = 'completed', progress = 100, stage = 'Complete', output_asset_ids = ?, error = NULL, completed_at = ? WHERE id = ?", [
        JSON.stringify(outputIds), finishedAt, job.id,
      ]);
    });
    committed = true;
    await db.flush();
    publishSnapshot();
  } catch (error) {
    if (!committed) await Promise.all(createdFiles.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
    throw error;
  }
}

function readFileHeaderSync(filePath: string): Uint8Array {
  const buffer = Buffer.alloc(64);
  const fd = openSync(filePath, 'r');
  try {
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(fd);
  }
}

function statSyncFor(filePath: string): { size: number; width: number | null; height: number | null } {
  const stat = statSync(filePath);
  let width: number | null = null;
  let height: number | null = null;
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(24);
    readSync(fd, buf, 0, buf.length, 0);
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      width = buf.readUInt32BE(16);
      height = buf.readUInt32BE(20);
    }
  } finally {
    closeSync(fd);
  }
  return { size: stat.size, width, height };
}

function dimensionsForFixture(mimeType: string, width: number | null, height: number | null): { width: number | null; height: number | null } {
  return mimeType.startsWith('image/') ? { width, height } : { width: null, height: null };
}

function resumeJobs(): void {
  const rows = mustStore().all("SELECT id FROM jobs WHERE status IN ('queued', 'running') ORDER BY created_at ASC");
  for (const row of rows) startMockJob(text(row, 'id'));
}

function validateAspectRatio(value: string): string {
  const allowed = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']);
  if (!allowed.has(value)) throw new ClipsError('INVALID_INPUT', 'Choose a supported aspect ratio.');
  return value;
}

function prepareGenerationRequest(request: GenerationRequest, kind: 'image'): GenerationJob {
  const settings = activeSettings();
  const prompt = request.prompt.trim();
  const modelId = request.modelId ?? settings.imageModelId;
  const aspectRatio = validateAspectRatio(request.aspectRatio ?? settings.imageAspectRatio);
  const outputCount = request.outputCount ?? settings.outputCount;
  modelFor(modelId, kind);
  const references = request.referenceAssetIds ?? settings.drafts.image.referenceAssetIds;
  validateExistingAssets(references, 'image');
  const characterId = request.characterId === undefined ? settings.drafts.image.characterId : request.characterId;
  validateCharacter(characterId);
  const inputAssetIds = [...new Set(references)];
  const job = insertJob({ kind, prompt, characterId: characterId ?? null, inputAssetIds, modelId, aspectRatio, outputCount });
  return job;
}

function prepareImageToVideoRequest(request: ImageToVideoRequest): GenerationJob {
  const settings = activeSettings();
  const prompt = request.prompt.trim();
  const modelId = request.modelId ?? settings.videoModelId;
  const aspectRatio = validateAspectRatio(request.aspectRatio ?? settings.videoAspectRatio);
  modelFor(modelId, 'video');
  validateExistingAssets([request.sourceImageId], 'image');
  const characterId = request.characterId === undefined ? settings.drafts.video.characterId : request.characterId;
  validateCharacter(characterId);
  const job = insertJob({
    kind: 'video',
    prompt,
    characterId: characterId ?? null,
    inputAssetIds: [request.sourceImageId],
    modelId,
    aspectRatio,
    outputCount: 1,
  });
  return job;
}

function findJob(id: EntityId): GenerationJob {
  const row = mustStore().one('SELECT * FROM jobs WHERE id = ?', [id]);
  if (!row) throw new ClipsError('NOT_FOUND', 'That generation is no longer in your history.');
  return jobFromRow(row);
}

function sendMenuAction(action: NativeMenuAction): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.menuAction, action);
}

function rebuildApplicationMenu(locale: Locale): void {
  menuLocale = locale;
  const copy = MENU_COPY[locale];
  app.setAboutPanelOptions({
    applicationName: 'Clips',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Nikita Berger',
    website: 'https://github.com/Nikityyy/Clips',
  });
  const fileItems: MenuItemConstructorOptions[] = [
    { id: 'clips-import-media', label: copy.importMedia, accelerator: 'CommandOrControl+O', click: () => sendMenuAction('import') },
    { type: 'separator' },
  ];
  const settingsItem: MenuItemConstructorOptions = {
    id: 'clips-settings', label: copy.settings, accelerator: 'CommandOrControl+,', click: () => sendMenuAction('settings'),
  };
  if (process.platform === 'darwin') {
    fileItems.push({ role: 'close', label: copy.closeWindow });
  } else {
    fileItems.push(settingsItem, { type: 'separator' }, { role: 'quit', label: copy.quit });
  }

  const viewItems: MenuItemConstructorOptions[] = [
    { id: 'clips-create', label: copy.create, click: () => sendMenuAction('create') },
    { id: 'clips-characters', label: copy.characters, click: () => sendMenuAction('characters') },
    { id: 'clips-images', label: copy.images, click: () => sendMenuAction('images') },
    { id: 'clips-videos', label: copy.videos, click: () => sendMenuAction('videos') },
    { id: 'clips-library', label: copy.library, click: () => sendMenuAction('library') },
    { id: 'clips-queue', label: copy.queue, click: () => sendMenuAction('queue') },
    { type: 'separator' },
    { role: 'togglefullscreen', label: copy.fullScreen },
  ];
  if (!app.isPackaged) viewItems.push({ type: 'separator' }, { role: 'reload', label: copy.reload }, { role: 'toggleDevTools', label: copy.developerTools });

  const template: MenuItemConstructorOptions[] = [];
  if (process.platform === 'darwin') {
    template.push({
      label: copy.app,
      submenu: [
        { role: 'about', label: copy.about },
        { type: 'separator' },
        { role: 'services', label: copy.services },
        { type: 'separator' },
        { role: 'hide', label: copy.hide },
        { role: 'hideOthers', label: copy.hideOthers },
        { role: 'unhide', label: copy.showAll },
        { type: 'separator' },
        settingsItem,
        { type: 'separator' },
        { role: 'quit', label: copy.quit },
      ],
    });
  }
  template.push(
    { label: copy.file, submenu: fileItems },
    { label: copy.edit, role: 'editMenu' },
    { label: copy.view, submenu: viewItems },
    process.platform === 'darwin'
      ? { role: 'windowMenu', label: copy.window }
      : { label: copy.window, submenu: [{ role: 'minimize', label: copy.minimize }, { role: 'zoom', label: copy.zoom }, { role: 'close', label: copy.closeWindow }] },
    { label: copy.help, submenu: [{ label: copy.helpLink, click: () => { void shell.openExternal('https://github.com/Nikityyy/Clips').catch(() => undefined); } }] },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installNativeContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    for (const suggestion of params.dictionarySuggestions) {
      items.push({ label: suggestion, click: () => window.webContents.replaceMisspelling(suggestion) });
    }
    if (params.misspelledWord) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: MENU_COPY[menuLocale].addToDictionary,
        click: () => window.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
    }
    if (params.isEditable) {
      if (items.length) items.push({ type: 'separator' });
      items.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    } else if (params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window });
  });
}

async function loadWindowState(): Promise<SavedWindowState | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(windowStatePath, 'utf8'));
    if (!value || typeof value !== 'object') return null;
    const state = value as Record<string, unknown>;
    const numbers = [state.x, state.y, state.width, state.height];
    if (!numbers.every((number) => typeof number === 'number' && Number.isFinite(number))) return null;
    if ((state.width as number) < 880 || (state.height as number) < 640) return null;
    return { x: state.x as number, y: state.y as number, width: state.width as number, height: state.height as number, maximized: state.maximized === true };
  } catch {
    return null;
  }
}

function restoredWindowBounds(state: SavedWindowState | null): { x?: number; y?: number; width: number; height: number } {
  const display = state
    ? screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height })
    : screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const minWidth = Math.min(880, workArea.width);
  const minHeight = Math.min(640, workArea.height);
  const width = Math.max(minWidth, Math.min(state?.width ?? 1440, 4096, workArea.width));
  const height = Math.max(minHeight, Math.min(state?.height ?? 960, 2160, workArea.height));
  if (!state) return { width, height };
  return {
    x: Math.min(Math.max(state.x, workArea.x - width + 120), workArea.x + workArea.width - 120),
    y: Math.min(Math.max(state.y, workArea.y), workArea.y + workArea.height - 80),
    width,
    height,
  };
}

function saveWindowState(window: BrowserWindow): Promise<void> {
  if (!windowStatePath || window.isDestroyed()) return windowStateWrite;
  const bounds = window.getNormalBounds();
  const data: SavedWindowState = { ...bounds, maximized: window.isMaximized() };
  windowStateWrite = windowStateWrite.catch(() => undefined).then(() => fs.writeFile(windowStatePath, JSON.stringify(data), 'utf8'));
  return windowStateWrite.catch((error: unknown) => { console.error('[Clips] Window preferences could not be saved:', error instanceof Error ? error.name : 'unknown'); });
}

function scheduleWindowStateSave(window: BrowserWindow): void {
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    windowStateTimer = null;
    void saveWindowState(window);
  }, 220);
}

function createWindow(): void {
  const preloadCandidates = [path.join(__dirname, 'preload.js'), path.join(__dirname, 'preload.cjs')];
  const preload = preloadCandidates.find((candidate) => existsSync(candidate)) ?? preloadCandidates[0];
  const bounds = restoredWindowBounds(savedWindowState);
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(880, bounds.width),
    minHeight: Math.min(640, bounds.height),
    backgroundColor: '#171719',
    show: false,
    title: 'Clips',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
    },
  });
  mainWindow.once('ready-to-show', () => {
    if (savedWindowState?.maximized) mainWindow?.maximize();
    mainWindow?.show();
  });
  const window = mainWindow;
  installNativeContextMenu(window);
  const persistBounds = () => scheduleWindowStateSave(window);
  window.on('resize', persistBounds);
  window.on('move', persistBounds);
  window.on('maximize', persistBounds);
  window.on('unmaximize', persistBounds);
  window.on('close', () => {
    if (windowStateTimer) clearTimeout(windowStateTimer);
    windowStateTimer = null;
    void saveWindowState(window);
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!trustedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.on('closed', () => { mainWindow = null; });

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'out', 'index.html'));
  } else {
    const configuredUrl = process.env.CLIPS_RENDERER_URL ?? 'http://localhost:3000';
    const rendererUrl = trustedRendererUrl(configuredUrl) ? configuredUrl : 'http://localhost:3000';
    void mainWindow.loadURL(rendererUrl);
  }
}

function installMediaProtocol(): void {
  protocol.handle('clips-media', async (request) => {
    try {
      const origin = request.headers.get('origin');
      const referrer = request.headers.get('referer');
      if (origin && origin !== 'null') {
        const allowedOrigin = app.isPackaged ? origin.startsWith('file://') : origin === 'http://localhost:3000';
        if (!allowedOrigin) return new Response('Forbidden', { status: 403 });
      }
      if (referrer && !trustedRendererUrl(referrer)) return new Response('Forbidden', { status: 403 });
      const url = new URL(request.url);
      if (url.hostname !== 'asset' || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (!/^[a-f0-9-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
      const row = mustStore().one('SELECT storage_name, mime_type, size_bytes FROM assets WHERE id = ? AND deleted_at IS NULL', [id]);
      if (!row) return new Response('Not found', { status: 404 });
      const filePath = safeMediaPath(text(row, 'storage_name'));
      const realDirectory = await fs.realpath(mediaDirectory);
      const realFile = await fs.realpath(filePath);
      if (path.dirname(realFile) !== realDirectory) return new Response('Not found', { status: 404 });
      const stat = await fs.stat(realFile);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Type': text(row, 'mime_type', 'application/octet-stream'),
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      if (request.method === 'HEAD') {
        headers.set('Content-Length', String(stat.size));
        return new Response(null, { status: 200, headers });
      }
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) {
          headers.set('Content-Range', `bytes */${stat.size}`);
          return new Response(null, { status: 416, headers });
        }
        let start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
        let end = match[2] && match[1] ? Math.min(stat.size - 1, Number(match[2])) : stat.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= stat.size) {
          headers.set('Content-Range', `bytes */${stat.size}`);
          return new Response(null, { status: 416, headers });
        }
        headers.set('Content-Length', String(end - start + 1));
        headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
        const body = Readable.toWeb(createReadStream(realFile, { start, end })) as ReadableStream<Uint8Array>;
        return new Response(body, { status: 206, headers });
      }
      headers.set('Content-Length', String(stat.size));
      const body = Readable.toWeb(createReadStream(realFile)) as ReadableStream<Uint8Array>;
      return new Response(body, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function readStorageSummary(): Promise<StorageSummary> {
  const directory = app.getPath('userData');
  let mediaFiles = 0;
  let mediaBytes = 0;
  try {
    for (const entry of await fs.readdir(mediaDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const stat = await fs.stat(path.join(mediaDirectory, entry.name));
      if (!stat.isFile()) continue;
      mediaFiles += 1;
      mediaBytes += stat.size;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ClipsError('STORAGE_ERROR', 'Clips could not read the size of its local media library.');
    }
  }
  let databaseBytes = 0;
  try {
    databaseBytes = (await fs.stat(path.join(directory, 'clips.sqlite'))).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ClipsError('STORAGE_ERROR', 'Clips could not read the size of its local database.');
    }
  }
  return { directory, mediaFiles, mediaBytes, databaseBytes };
}

function registerIpc(): void {
  handle(IPC_CHANNELS.getSnapshot, TRUSTED_NO_INPUT, () => getSnapshot());
  handle(IPC_CHANNELS.getStorageSummary, TRUSTED_NO_INPUT, readStorageSummary);
  handle(IPC_CHANNELS.openDataFolder, TRUSTED_NO_INPUT, async () => {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new ClipsError('STORAGE_ERROR', 'Clips could not open its local data folder.');
  });

  handle(IPC_CHANNELS.importFiles, TRUSTED_NO_INPUT, async () => {
    const selection = await dialog.showOpenDialog(mainWindow!, {
      title: 'Add media to Clips',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and video', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'mp4', 'mov', 'webm'] }],
    });
    return importPaths(selection.filePaths, importContext('import'));
  });

  handle(IPC_CHANNELS.importPaths, IpcSchema.importPaths, ({ paths }) => importPaths(paths, importContext('import')));

  handle(IPC_CHANNELS.importFlowFiles, IpcSchema.flowImport, async (input: FlowImportInput) => {
    const settings = activeSettings();
    const activeAccount = mustStore().one('SELECT * FROM accounts WHERE id = ?', [settings.activeAccountId]);
    if (!activeAccount || text(activeAccount, 'provider') !== 'google-flow') {
      throw new ClipsError('PROVIDER_UNAVAILABLE', 'Choose a Google Flow account label before importing Flow downloads.');
    }
    const selection = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import downloads from Flow',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and video', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'mp4', 'mov', 'webm'] }],
    });
    const context: ImportContext = {
      source: 'flow-handoff',
      provider: 'google-flow',
      accountId: settings.activeAccountId,
      prompt: input.prompt ?? null,
      modelId: null,
      sourceAssetIds: input.sourceAssetIds ?? [],
      characterId: input.characterId ?? null,
    };
    return importPaths(selection.filePaths, context);
  });

  handle(IPC_CHANNELS.pasteClipboardImage, TRUSTED_NO_INPUT, async () => {
    let clipboardItems;
    try {
      clipboardItems = await clipboard.read();
    } catch {
      throw new ClipsError('UNSUPPORTED_MEDIA', 'Clips could not read the clipboard. Copy an image, then try again.');
    }
    const clipboardItem = clipboardItems.find((item) => item.types.includes('image/png'));
    if (!clipboardItem) throw new ClipsError('UNSUPPORTED_MEDIA', 'There is no PNG image on the clipboard. Copy an image, then try again.');

    let payload: Blob | { title: string; url: string };
    try {
      payload = await clipboardItem.getType('image/png');
    } catch {
      throw new ClipsError('UNSUPPORTED_MEDIA', 'The copied image is no longer available. Copy it again, then try once more.');
    }
    if (!(payload instanceof Blob)) throw new ClipsError('UNSUPPORTED_MEDIA', 'The clipboard item is not an image. Copy another image and try again.');
    const blob = payload;
    if (blob.size === 0) throw new ClipsError('UNSUPPORTED_MEDIA', 'The clipboard image is empty. Copy another image and try again.');
    if (blob.size > MAX_IMAGE_BYTES) throw new ClipsError('FILE_TOO_LARGE', 'The clipboard image is larger than 100 MB.');

    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ClipsError('FILE_TOO_LARGE', 'The clipboard image is larger than 100 MB.');
    const detected = mimeForFile(bytes);
    if (!detected || detected.kind !== 'image' || detected.mimeType !== 'image/png') {
      throw new ClipsError('UNSUPPORTED_MEDIA', 'The clipboard item was not a valid PNG image. Copy another image and try again.');
    }

    const temporaryPath = path.join(app.getPath('temp'), `clips-paste-${randomUUID()}.png`);
    await fs.writeFile(temporaryPath, bytes);
    try {
      return await importPaths([temporaryPath], importContext('clipboard'));
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  });

  handle(IPC_CHANNELS.saveDraft, IpcSchema.saveDraft, async ({ mode, draft }) => {
    const settings = activeSettings();
    validateCharacter(draft.characterId);
    validateExistingAssets(draft.referenceAssetIds, 'image');
    if (draft.sourceImageId) validateExistingAssets([draft.sourceImageId], 'image');
    modelFor(draft.modelId, mode);
    validateAspectRatio(draft.aspectRatio);
    settings.drafts[mode] = { ...draft };
    mustStore().setSetting('app', settings);
    await flushAndPublish();
    return settings.drafts[mode];
  });

  handle(IPC_CHANNELS.setLocale, z.object({ locale: IpcSchema.locale }).strict(), async ({ locale }: { locale: Locale }) => {
    const settings = activeSettings();
    settings.locale = locale;
    mustStore().setSetting('app', settings);
    await flushAndPublish();
    rebuildApplicationMenu(locale);
    return settings;
  });

  handle(IPC_CHANNELS.updateSettings, IpcSchema.settingsPatch, async (patch: SettingsPatch) => {
    const settings = activeSettings();
    if (patch.imageModelId) modelFor(patch.imageModelId, 'image');
    if (patch.videoModelId) modelFor(patch.videoModelId, 'video');
    if (patch.imageAspectRatio) validateAspectRatio(patch.imageAspectRatio);
    if (patch.videoAspectRatio) validateAspectRatio(patch.videoAspectRatio);
    Object.assign(settings, patch);
    settings.drafts.image = {
      ...settings.drafts.image,
      modelId: settings.imageModelId,
      aspectRatio: settings.imageAspectRatio,
      outputCount: settings.outputCount,
    };
    settings.drafts.video = {
      ...settings.drafts.video,
      modelId: settings.videoModelId,
      aspectRatio: settings.videoAspectRatio,
    };
    mustStore().setSetting('app', settings);
    await flushAndPublish();
    if (patch.locale) rebuildApplicationMenu(patch.locale);
    return settings;
  });

  handle(IPC_CHANNELS.createCharacter, IpcSchema.createCharacter, async (input: CreateCharacterInput) => {
    const db = mustStore();
    const id = randomUUID();
    const createdAt = nowIso();
    const references = input.referenceAssetIds ?? [];
    validateExistingAssets(references, 'image');
    if (input.portraitAssetId) validateExistingAssets([input.portraitAssetId], 'image');
    db.transaction(() => {
      db.run('INSERT INTO characters (id, name, description, prompt, portrait_asset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id, input.name.trim(), input.description ?? '', input.prompt ?? '', input.portraitAssetId ?? null, createdAt, createdAt,
      ]);
      associateCharacter(id, references);
      if (input.portraitAssetId) db.run('INSERT OR IGNORE INTO character_references (character_id, asset_id) VALUES (?, ?)', [id, input.portraitAssetId]);
    });
    await flushAndPublish();
    return characterFromRow(db.one('SELECT * FROM characters WHERE id = ?', [id])!);
  });

  handle(IPC_CHANNELS.updateCharacter, IpcSchema.updateCharacter, async ({ id, patch }: { id: EntityId; patch: UpdateCharacterInput }) => {
    const db = mustStore();
    const row = db.one('SELECT * FROM characters WHERE id = ?', [id]);
    if (!row) throw new ClipsError('NOT_FOUND', 'That character is no longer in your library.');
    if (patch.referenceAssetIds) validateExistingAssets(patch.referenceAssetIds, 'image');
    if (patch.portraitAssetId) validateExistingAssets([patch.portraitAssetId], 'image');
    const updatedAt = nowIso();
    db.transaction(() => {
      db.run('UPDATE characters SET name = ?, description = ?, prompt = ?, portrait_asset_id = ?, updated_at = ? WHERE id = ?', [
        patch.name?.trim() ?? text(row, 'name'),
        patch.description ?? text(row, 'description'),
        patch.prompt ?? text(row, 'prompt'),
        patch.portraitAssetId === undefined ? nullableText(row, 'portrait_asset_id') : patch.portraitAssetId,
        updatedAt,
        id,
      ]);
      if (patch.referenceAssetIds) associateCharacter(id, patch.referenceAssetIds);
      if (patch.portraitAssetId) db.run('INSERT OR IGNORE INTO character_references (character_id, asset_id) VALUES (?, ?)', [id, patch.portraitAssetId]);
    });
    await flushAndPublish();
    return characterFromRow(db.one('SELECT * FROM characters WHERE id = ?', [id])!);
  });

  handle(IPC_CHANNELS.deleteCharacter, z.object({ id: IpcSchema.id }).strict(), async ({ id }: { id: EntityId }) => {
    const db = mustStore();
    const existing = db.one('SELECT id FROM characters WHERE id = ?', [id]);
    if (!existing) throw new ClipsError('NOT_FOUND', 'That character is no longer in your library.');
    db.run('DELETE FROM characters WHERE id = ?', [id]);
    await flushAndPublish();
  });

  handle(IPC_CHANNELS.assignCharacter, z.object({ assetId: IpcSchema.id, characterId: IpcSchema.id.nullable() }).strict(), async ({ assetId, characterId }: { assetId: EntityId; characterId: EntityId | null }) => {
    const db = mustStore();
    validateExistingAssets([assetId]);
    validateCharacter(characterId);
    db.run('DELETE FROM asset_characters WHERE asset_id = ?', [assetId]);
    if (characterId) db.run('INSERT INTO asset_characters (asset_id, character_id) VALUES (?, ?)', [assetId, characterId]);
    await flushAndPublish();
    return assetFromRow(db.one('SELECT * FROM assets WHERE id = ?', [assetId])!);
  });

  handle(IPC_CHANNELS.deleteAsset, z.object({ id: IpcSchema.id }).strict(), async ({ id }: { id: EntityId }) => {
    const db = mustStore();
    const asset = db.one('SELECT id, deleted_at FROM assets WHERE id = ?', [id]);
    if (!asset || nullableText(asset, 'deleted_at')) throw new ClipsError('NOT_FOUND', 'That file is no longer in your library.');
    const batchId = randomUUID();
    db.run('UPDATE assets SET deleted_at = ?, delete_batch_id = ? WHERE id = ?', [nowIso(), batchId, id]);
    db.setSetting('lastDeleteBatchId', batchId);
    await flushAndPublish();
    return { deletedAssetId: id, undoAvailable: true as const };
  });

  handle(IPC_CHANNELS.undoDelete, TRUSTED_NO_INPUT, async () => {
    const db = mustStore();
    const batchId = db.setting<string | null>('lastDeleteBatchId', null);
    if (!batchId) return { restored: [] as Asset[] };
    const ids = db.all('SELECT id FROM assets WHERE delete_batch_id = ? AND deleted_at IS NOT NULL', [batchId]).map((row) => text(row, 'id'));
    db.run('UPDATE assets SET deleted_at = NULL, delete_batch_id = NULL WHERE delete_batch_id = ?', [batchId]);
    db.setSetting('lastDeleteBatchId', null);
    await flushAndPublish();
    return { restored: ids.map((id) => assetFromRow(db.one('SELECT * FROM assets WHERE id = ?', [id])!)) };
  });

  handle(IPC_CHANNELS.generateImage, IpcSchema.generate, async (request: GenerationRequest) => {
    const job = prepareGenerationRequest(request, 'image');
    await mustStore().flush();
    publishSnapshot();
    startMockJob(job.id);
    return job;
  });

  handle(IPC_CHANNELS.generateVideo, IpcSchema.imageToVideo, async (request: ImageToVideoRequest) => {
    const job = prepareImageToVideoRequest(request);
    await mustStore().flush();
    publishSnapshot();
    startMockJob(job.id);
    return job;
  });

  handle(IPC_CHANNELS.retryJob, z.object({ id: IpcSchema.id }).strict(), async ({ id }: { id: EntityId }) => {
    const oldJob = findJob(id);
    if (!['failed', 'cancelled'].includes(oldJob.status)) throw new ClipsError('JOB_NOT_RETRYABLE', 'Only failed or cancelled jobs can be retried.');
    validateCharacter(oldJob.characterId);
    validateExistingAssets(oldJob.inputAssetIds, 'image');
    const retry = insertJob({
      kind: oldJob.kind,
      prompt: oldJob.prompt,
      characterId: oldJob.characterId,
      inputAssetIds: oldJob.inputAssetIds,
      modelId: oldJob.modelId,
      aspectRatio: oldJob.aspectRatio,
      outputCount: oldJob.outputCount,
      retryOfJobId: oldJob.id,
    });
    await mustStore().flush();
    publishSnapshot();
    startMockJob(retry.id);
    return retry;
  });

  handle(IPC_CHANNELS.cancelJob, z.object({ id: IpcSchema.id }).strict(), async ({ id }: { id: EntityId }) => {
    const db = mustStore();
    const job = findJob(id);
    if (job.status !== 'queued' && job.status !== 'running') throw new ClipsError('JOB_NOT_CANCELLABLE', 'That job has already finished.');
    db.run("UPDATE jobs SET status = 'cancelled', progress = 0, stage = 'Cancelled', completed_at = ?, error = NULL WHERE id = ?", [nowIso(), id]);
    await flushAndPublish();
    return findJob(id);
  });

  handle(IPC_CHANNELS.addAccount, IpcSchema.addAccount, async ({ provider, label }) => {
    const db = mustStore();
    const id = randomUUID();
    const account: ProviderAccount = {
      id,
      provider,
      label: label.trim(),
      connection: provider === 'mock' ? 'mock-ready' : 'browser-handoff',
      createdAt: nowIso(),
    };
    db.run('INSERT INTO accounts (id, provider, label, connection, created_at) VALUES (?, ?, ?, ?, ?)', [
      account.id, account.provider, account.label, account.connection, account.createdAt,
    ]);
    await flushAndPublish();
    return account;
  });

  handle(IPC_CHANNELS.switchAccount, IpcSchema.switchAccount, async ({ accountId }) => {
    const account = mustStore().one('SELECT * FROM accounts WHERE id = ?', [accountId]);
    if (!account) throw new ClipsError('NOT_FOUND', 'That account label is no longer available.');
    setAccountInSettings(accountId);
    await flushAndPublish();
    return accountFromRow(account);
  });

  handle(IPC_CHANNELS.removeAccount, IpcSchema.removeAccount, async ({ accountId }) => {
    const db = mustStore();
    const existing = db.one('SELECT * FROM accounts WHERE id = ?', [accountId]);
    if (!existing) throw new ClipsError('NOT_FOUND', 'That account label is no longer available.');
    const accounts = db.all('SELECT * FROM accounts ORDER BY created_at ASC, rowid ASC');
    if (accounts.length < 2) throw new ClipsError('ACCOUNT_IN_USE', 'Keep at least one provider profile in Clips.');
    const usage = db.one(
      'SELECT (SELECT COUNT(*) FROM assets WHERE account_id = ?) + (SELECT COUNT(*) FROM jobs WHERE account_id = ?) AS total',
      [accountId, accountId],
    );
    if (numberValue(usage ?? {}, 'total') > 0) {
      throw new ClipsError('ACCOUNT_IN_USE', 'This account is named in your saved history. Switch accounts and keep the label to preserve that history.');
    }
    const settings = activeSettings();
    db.run('DELETE FROM accounts WHERE id = ?', [accountId]);
    if (settings.activeAccountId === accountId) {
      const replacement = accounts.find((item) => text(item, 'id') !== accountId)!;
      settings.activeAccountId = text(replacement, 'id');
      db.setSetting('app', settings);
    }
    await flushAndPublish();
  });

  handle(IPC_CHANNELS.openFlow, TRUSTED_NO_INPUT, async () => {
    await shell.openExternal(FLOW_URL);
  });

  handle(IPC_CHANNELS.revealAsset, z.object({ id: IpcSchema.id }).strict(), async ({ id }: { id: EntityId }) => {
    const row = mustStore().one('SELECT storage_name FROM assets WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!row) throw new ClipsError('NOT_FOUND', 'That file is no longer in your library.');
    shell.showItemInFolder(safeMediaPath(text(row, 'storage_name')));
  });
}

async function initialize(): Promise<void> {
  await app.whenReady();
  app.setName('Clips');
  const userData = app.getPath('userData');
  mediaDirectory = path.join(userData, 'media');
  windowStatePath = path.join(userData, 'window-state.json');
  await fs.mkdir(mediaDirectory, { recursive: true });
  store = await DatabaseStore.open(path.join(userData, 'clips.sqlite'));
  await seedLocalLibrary();
  savedWindowState = await loadWindowState();
  rebuildApplicationMenu(activeSettings().locale);
  installMediaProtocol();
  registerIpc();
  createWindow();
  resumeJobs();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

if (!app.isPackaged && process.env.CLIPS_TEST_USER_DATA) {
  const testDataDirectory = path.resolve(process.env.CLIPS_TEST_USER_DATA);
  app.setPath('userData', testDataDirectory);
  app.setPath('sessionData', path.join(testDataDirectory, 'session'));
}
else if (app.isPackaged && process.env.CLIPS_TEST_PACKAGED_USER_DATA) {
  const packagedTestDataDirectory = path.resolve(process.env.CLIPS_TEST_PACKAGED_USER_DATA);
  app.setPath('userData', packagedTestDataDirectory);
  app.setPath('sessionData', path.join(packagedTestDataDirectory, 'session'));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  void initialize().catch((error) => {
    console.error('[Clips] Startup failed:', error instanceof Error ? error.name : 'unknown');
    app.quit();
  });
}

let closingStore = false;
app.on('before-quit', (event) => {
  if (!store || closingStore) return;
  event.preventDefault();
  closingStore = true;
  const closing = store;
  store = null;
  void Promise.all([closing.close(), windowStateWrite]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
