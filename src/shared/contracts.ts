import { z } from 'zod';

/** Stable IDs are generated in the main process and are safe for IPC and URLs. */
export type EntityId = string;
export type Locale = 'en' | 'de';
export type AssetKind = 'image' | 'video';
export type AssetSource = 'import' | 'clipboard' | 'mock' | 'flow-handoff';
export type ProviderKind = 'mock' | 'google-flow';
export type JobKind = 'image' | 'video';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Fixed invoke/event routes shared by the isolated preload and the main process. */
export const IPC_CHANNELS = {
  snapshotUpdated: 'clips:snapshot',
  getSnapshot: 'clips:get-snapshot',
  importFiles: 'clips:import-files',
  importFlowFiles: 'clips:import-flow-files',
  importPaths: 'clips:import-paths',
  pasteClipboardImage: 'clips:paste-clipboard-image',
  saveDraft: 'clips:save-draft',
  setLocale: 'clips:set-locale',
  updateSettings: 'clips:update-settings',
  createCharacter: 'clips:create-character',
  updateCharacter: 'clips:update-character',
  deleteCharacter: 'clips:delete-character',
  assignCharacter: 'clips:assign-character',
  deleteAsset: 'clips:delete-asset',
  undoDelete: 'clips:undo-delete',
  generateImage: 'clips:generate-image',
  generateVideo: 'clips:generate-video',
  retryJob: 'clips:retry-job',
  cancelJob: 'clips:cancel-job',
  addAccount: 'clips:add-account',
  switchAccount: 'clips:switch-account',
  removeAccount: 'clips:remove-account',
  openFlow: 'clips:open-flow',
  revealAsset: 'clips:reveal-asset',
} as const;

export interface AssetProvenance {
  source: AssetSource;
  provider: ProviderKind | null;
  accountId: EntityId | null;
  jobId: EntityId | null;
  prompt: string | null;
  model: string | null;
  sourceAssetIds: EntityId[];
  characterIds: EntityId[];
  createdAt: string;
}

/** `uri` is a clips-media:// URL; it never exposes the on-disk file path. */
export interface Asset {
  id: EntityId;
  kind: AssetKind;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  uri: string;
  createdAt: string;
  deletedAt: string | null;
  provenance: AssetProvenance;
}

export interface Character {
  id: EntityId;
  name: string;
  description: string;
  prompt: string;
  portraitAssetId: EntityId | null;
  referenceAssetIds: EntityId[];
  createdAt: string;
  updatedAt: string;
}

export interface GenerationDraft {
  prompt: string;
  characterId: EntityId | null;
  referenceAssetIds: EntityId[];
  modelId: string;
  aspectRatio: string;
  outputCount: number;
  sourceImageId: EntityId | null;
}

export interface GenerationRequest {
  prompt: string;
  characterId?: EntityId | null;
  referenceAssetIds?: EntityId[];
  modelId?: string;
  aspectRatio?: string;
  outputCount?: number;
}

export interface ImageToVideoRequest {
  prompt: string;
  sourceImageId: EntityId;
  characterId?: EntityId | null;
  modelId?: string;
  aspectRatio?: string;
}

export interface FlowImportInput {
  prompt?: string;
  sourceAssetIds?: EntityId[];
  characterId?: EntityId | null;
}

export interface GenerationJob {
  id: EntityId;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  stage: string;
  prompt: string;
  characterId: EntityId | null;
  inputAssetIds: EntityId[];
  outputAssetIds: EntityId[];
  modelId: string;
  aspectRatio: string;
  outputCount: number;
  accountId: EntityId | null;
  provider: 'mock';
  error: string | null;
  retryOfJobId: EntityId | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Epoch milliseconds; used only to resume deterministic mock progress. */
  progressStartedAt: number | null;
}

export interface ProviderAccount {
  id: EntityId;
  provider: ProviderKind;
  label: string;
  /** Flow accounts are labels only: Clips stores no cookies or Google tokens. */
  connection: 'mock-ready' | 'browser-handoff';
  createdAt: string;
}

export interface ProviderModel {
  id: string;
  label: string;
  kind: JobKind;
  description: string;
  supportsReferences: boolean;
  supportsCharacter: boolean;
  creditCost: 0;
}

export interface ProviderCapabilities {
  provider: 'mock';
  label: string;
  detail: string;
  models: ProviderModel[];
  supportsImageToVideo: boolean;
  creditCost: 0;
}

export interface Settings {
  locale: Locale;
  activeAccountId: EntityId;
  imageModelId: string;
  videoModelId: string;
  imageAspectRatio: string;
  videoAspectRatio: string;
  outputCount: number;
  drafts: {
    image: GenerationDraft;
    video: GenerationDraft;
  };
}

export interface AppSnapshot {
  revision: number;
  updatedAt: string;
  assets: Asset[];
  characters: Character[];
  jobs: GenerationJob[];
  accounts: ProviderAccount[];
  settings: Settings;
  capabilities: ProviderCapabilities;
  undoDeleteAvailable: boolean;
}

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'UNSUPPORTED_MEDIA'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'STORAGE_ERROR'
  | 'PROVIDER_UNAVAILABLE'
  | 'JOB_NOT_RETRYABLE'
  | 'JOB_NOT_CANCELLABLE'
  | 'ACCOUNT_IN_USE'
  | 'PERMISSION_DENIED'
  | 'INTERNAL';

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export interface ImportIssue {
  name: string;
  code: ErrorCode;
  message: string;
}

export interface ImportSummary {
  imported: Asset[];
  rejected: ImportIssue[];
}

export interface DeleteSummary {
  deletedAssetId: EntityId;
  undoAvailable: true;
}

export interface UndoDeleteSummary {
  restored: Asset[];
}

export interface CreateCharacterInput {
  name: string;
  description?: string;
  prompt?: string;
  portraitAssetId?: EntityId | null;
  referenceAssetIds?: EntityId[];
}

export interface UpdateCharacterInput {
  name?: string;
  description?: string;
  prompt?: string;
  portraitAssetId?: EntityId | null;
  referenceAssetIds?: EntityId[];
}

export interface AddAccountInput {
  provider: ProviderKind;
  label: string;
}

export interface SettingsPatch {
  locale?: Locale;
  imageModelId?: string;
  videoModelId?: string;
  imageAspectRatio?: string;
  videoAspectRatio?: string;
  outputCount?: number;
}

export interface ClipsApi {
  getSnapshot(): Promise<Result<AppSnapshot>>;
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void;

  importFiles(): Promise<Result<ImportSummary>>;
  /** Import files manually downloaded from the official Flow site and label their origin. */
  importFlowFiles(input?: FlowImportInput): Promise<Result<ImportSummary>>;
  importDroppedFiles(files: readonly File[]): Promise<Result<ImportSummary>>;
  pasteClipboardImage(): Promise<Result<ImportSummary>>;

  saveDraft(mode: JobKind, draft: GenerationDraft): Promise<Result<GenerationDraft>>;
  setLocale(locale: Locale): Promise<Result<Settings>>;
  updateSettings(patch: SettingsPatch): Promise<Result<Settings>>;

  createCharacter(input: CreateCharacterInput): Promise<Result<Character>>;
  updateCharacter(id: EntityId, patch: UpdateCharacterInput): Promise<Result<Character>>;
  deleteCharacter(id: EntityId): Promise<Result<void>>;
  assignAssetToCharacter(assetId: EntityId, characterId: EntityId | null): Promise<Result<Asset>>;

  deleteAsset(id: EntityId): Promise<Result<DeleteSummary>>;
  undoDelete(): Promise<Result<UndoDeleteSummary>>;

  generate(request: GenerationRequest): Promise<Result<GenerationJob>>;
  generateImageToVideo(request: ImageToVideoRequest): Promise<Result<GenerationJob>>;
  retryJob(jobId: EntityId): Promise<Result<GenerationJob>>;
  cancelJob(jobId: EntityId): Promise<Result<GenerationJob>>;

  addAccount(input: AddAccountInput): Promise<Result<ProviderAccount>>;
  switchAccount(accountId: EntityId): Promise<Result<ProviderAccount>>;
  removeAccount(accountId: EntityId): Promise<Result<void>>;

  openFlow(): Promise<Result<void>>;
  revealAsset(assetId: EntityId): Promise<Result<void>>;
}

const entityId = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const nonEmpty = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0);
const localeSchema = z.enum(['en', 'de']);
const ratioSchema = z.enum(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']);
const modelIdSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_.-]+$/);

export const IpcSchema = {
  id: entityId,
  mode: z.enum(['image', 'video']),
  locale: localeSchema,
  importPaths: z.object({ paths: z.array(z.string().min(1).max(4096)).max(20) }).strict(),
  flowImport: z.object({
    prompt: z.string().max(20000).optional(),
    sourceAssetIds: z.array(entityId).max(12).optional(),
    characterId: entityId.nullable().optional(),
  }).strict(),
  saveDraft: z.object({
    mode: z.enum(['image', 'video']),
    draft: z.object({
      prompt: z.string().max(20000),
      characterId: entityId.nullable(),
      referenceAssetIds: z.array(entityId).max(12),
      modelId: modelIdSchema,
      aspectRatio: ratioSchema,
      outputCount: z.number().int().min(1).max(6),
      sourceImageId: entityId.nullable(),
    }).strict(),
  }).strict(),
  settingsPatch: z.object({
    locale: localeSchema.optional(),
    imageModelId: modelIdSchema.optional(),
    videoModelId: modelIdSchema.optional(),
    imageAspectRatio: ratioSchema.optional(),
    videoAspectRatio: ratioSchema.optional(),
    outputCount: z.number().int().min(1).max(6).optional(),
  }).strict(),
  generate: z.object({
    prompt: nonEmpty(20000),
    characterId: entityId.nullable().optional(),
    referenceAssetIds: z.array(entityId).max(12).optional(),
    modelId: modelIdSchema.optional(),
    aspectRatio: ratioSchema.optional(),
    outputCount: z.number().int().min(1).max(6).optional(),
  }).strict(),
  imageToVideo: z.object({
    prompt: nonEmpty(20000),
    sourceImageId: entityId,
    characterId: entityId.nullable().optional(),
    modelId: modelIdSchema.optional(),
    aspectRatio: ratioSchema.optional(),
  }).strict(),
  createCharacter: z.object({
    name: nonEmpty(80),
    description: z.string().max(600).optional(),
    prompt: z.string().max(6000).optional(),
    portraitAssetId: entityId.nullable().optional(),
    referenceAssetIds: z.array(entityId).max(12).optional(),
  }).strict(),
  updateCharacter: z.object({
    id: entityId,
    patch: z.object({
      name: nonEmpty(80).optional(),
      description: z.string().max(600).optional(),
      prompt: z.string().max(6000).optional(),
      portraitAssetId: entityId.nullable().optional(),
      referenceAssetIds: z.array(entityId).max(12).optional(),
    }).strict(),
  }).strict(),
  assignCharacter: z.object({ assetId: entityId, characterId: entityId.nullable() }).strict(),
  addAccount: z.object({ provider: z.enum(['mock', 'google-flow']), label: nonEmpty(80) }).strict(),
  switchAccount: z.object({ accountId: entityId }).strict(),
  removeAccount: z.object({ accountId: entityId }).strict(),
} as const;

declare global {
  interface Window {
    clips: ClipsApi;
  }
}

export function toAssetUri(assetId: EntityId): string {
  return `clips-media://asset/${encodeURIComponent(assetId)}`;
}
