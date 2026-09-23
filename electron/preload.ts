import { contextBridge, ipcRenderer, webUtils } from 'electron';
// Keep this small table inline: sandboxed preloads can load Electron's bridge APIs,
// but cannot require ordinary local modules at runtime.
const IPC_CHANNELS = {
  snapshotUpdated: 'clips:snapshot',
  menuAction: 'clips:menu-action',
  getSnapshot: 'clips:get-snapshot',
  getStorageSummary: 'clips:get-storage-summary',
  openDataFolder: 'clips:open-data-folder',
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
import type {
  AddAccountInput,
  AppSnapshot,
  Asset,
  ClipsApi,
  CreateCharacterInput,
  DeleteSummary,
  EntityId,
  FlowImportInput,
  GenerationDraft,
  GenerationJob,
  GenerationRequest,
  ImageToVideoRequest,
  ImportSummary,
  JobKind,
  Locale,
  NativeMenuAction,
  Result,
  ProviderAccount,
  Character,
  UndoDeleteSummary,
  Settings,
  SettingsPatch,
  StorageSummary,
  UpdateCharacterInput,
} from '../src/shared/contracts';

const invoke = <T>(channel: string, payload?: unknown): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, payload) as Promise<Result<T>>;

const api: ClipsApi = {
  getSnapshot: () => invoke<AppSnapshot>(IPC_CHANNELS.getSnapshot),
  getStorageSummary: () => invoke<StorageSummary>(IPC_CHANNELS.getStorageSummary),
  openDataFolder: () => invoke<void>(IPC_CHANNELS.openDataFolder),
  subscribe(listener) {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on(IPC_CHANNELS.snapshotUpdated, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.snapshotUpdated, handler);
  },
  subscribeMenuAction(listener) {
    const handler = (_event: Electron.IpcRendererEvent, action: NativeMenuAction) => listener(action);
    ipcRenderer.on(IPC_CHANNELS.menuAction, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.menuAction, handler);
  },

  importFiles: () => invoke<ImportSummary>(IPC_CHANNELS.importFiles),
  importFlowFiles: (input: FlowImportInput = {}) => invoke<ImportSummary>(IPC_CHANNELS.importFlowFiles, input),
  importDroppedFiles(files) {
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    return invoke<ImportSummary>(IPC_CHANNELS.importPaths, { paths });
  },
  pasteClipboardImage: () => invoke<ImportSummary>(IPC_CHANNELS.pasteClipboardImage),

  saveDraft: (mode: JobKind, draft: GenerationDraft) => invoke<GenerationDraft>(IPC_CHANNELS.saveDraft, { mode, draft }),
  setLocale: (locale: Locale) => invoke<Settings>(IPC_CHANNELS.setLocale, { locale }),
  updateSettings: (patch: SettingsPatch) => invoke<Settings>(IPC_CHANNELS.updateSettings, patch),

  createCharacter: (input: CreateCharacterInput) => invoke<Character>(IPC_CHANNELS.createCharacter, input),
  updateCharacter: (id: EntityId, patch: UpdateCharacterInput) => invoke<Character>(IPC_CHANNELS.updateCharacter, { id, patch }),
  deleteCharacter: (id: EntityId) => invoke<void>(IPC_CHANNELS.deleteCharacter, { id }),
  assignAssetToCharacter: (assetId: EntityId, characterId: EntityId | null) =>
    invoke<Asset>(IPC_CHANNELS.assignCharacter, { assetId, characterId }),

  deleteAsset: (id: EntityId) => invoke<DeleteSummary>(IPC_CHANNELS.deleteAsset, { id }),
  undoDelete: () => invoke<UndoDeleteSummary>(IPC_CHANNELS.undoDelete),

  generate: (request: GenerationRequest) => invoke<GenerationJob>(IPC_CHANNELS.generateImage, request),
  generateImageToVideo: (request: ImageToVideoRequest) => invoke<GenerationJob>(IPC_CHANNELS.generateVideo, request),
  retryJob: (jobId: EntityId) => invoke<GenerationJob>(IPC_CHANNELS.retryJob, { id: jobId }),
  cancelJob: (jobId: EntityId) => invoke<GenerationJob>(IPC_CHANNELS.cancelJob, { id: jobId }),

  addAccount: (input: AddAccountInput) => invoke<ProviderAccount>(IPC_CHANNELS.addAccount, input),
  switchAccount: (accountId: EntityId) => invoke<ProviderAccount>(IPC_CHANNELS.switchAccount, { accountId }),
  removeAccount: (accountId: EntityId) => invoke<void>(IPC_CHANNELS.removeAccount, { accountId }),

  openFlow: () => invoke<void>(IPC_CHANNELS.openFlow),
  revealAsset: (assetId: EntityId) => invoke<void>(IPC_CHANNELS.revealAsset, { id: assetId }),
};

contextBridge.exposeInMainWorld('clips', api);
