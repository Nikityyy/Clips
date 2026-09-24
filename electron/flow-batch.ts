import { randomUUID } from 'node:crypto';

/** FlowKit-derived wire identifiers; see public/licenses/MIT-FlowKit.txt. */
export const FLOW_RPC = {
  generateImage: 'ogiZ0b',
  generateVideo: 'eb1hJf',
  generateTextVideo: 'YhhmEf',
  generateFirstLastVideo: 'nprQif',
  generateReferenceVideo: 'MZZa6b',
  operation: 'jwpduf',
  projectMedia: 'Zzl0ze',
  media: 'as29s',
  uploadImage: 'maseQ',
  upscaleImage: 'SPrCad',
} as const;

export const FLOW_CAPTCHA = {
  image: 'IMAGE_GENERATION',
  video: 'VIDEO_GENERATION',
} as const;

export const FLOW_IMAGE_ASPECTS: Readonly<Record<string, number>> = {
  '1:1': 1,
  '9:16': 2,
  '16:9': 3,
  '3:4': 4,
  '4:3': 5,
};

export const FLOW_VIDEO_ASPECTS: Readonly<Record<string, number>> = { '9:16': 1, '16:9': 2 };

/** Convert the live gflow catalog aliases into wire models verified on the new batch API. */
export function resolveImageBatchModel(modelId: string): string {
  const aliases: Record<string, string> = {
    'nano-pro': 'GEM_PIX_2',
    'nano2': 'NARWHAL',
    'nano2-lite': 'HARBOR_SEAL',
    'nano-lite': 'HARBOR_SEAL',
    'GEM_PIX_2': 'GEM_PIX_2',
    'NARWHAL': 'NARWHAL',
    'HARBOR_SEAL': 'HARBOR_SEAL',
  };
  const resolved = aliases[modelId] ?? aliases[modelId.toLowerCase()];
  if (!resolved) throw new RangeError(`Flow image model is not verified for batchexecute: ${modelId}`);
  return resolved;
}

export function isSupportedFlowBatchModel(kind: 'image' | 'video', aliases: string[]): boolean {
  const normalized = new Set(aliases.map((alias) => alias.toLowerCase()));
  if (kind === 'video') return normalized.has('omni-flash') || normalized.has('abra_t2v_4s');
  return [...normalized].some((alias) => ['nano-pro', 'nano2', 'nano2-lite', 'nano-lite', 'gem_pix_2', 'narwhal', 'harbor_seal'].includes(alias));
}

function resolveVideoBatchModel(modelId: string, mode: 'text' | 'image' | 'reference'): string {
  const verified = mode === 'text' ? 'abra_t2v_4s' : mode === 'image' ? 'abra_i2v_8s' : 'abra_r2v_8s';
  if (modelId === 'omni-flash' || modelId === verified) return verified;
  throw new RangeError(`Flow video model is not verified for this batchexecute mode: ${modelId}`);
}

export const FLOW_FULL_FRAME_CROP = [null, null, 1, 1] as const;
const CAPTCHA_SLOT = '__CLIPS_CAPTCHA__';

function uuid(): string { return randomUUID().toUpperCase(); }
function imageAspect(ratio: string): number {
  const value = FLOW_IMAGE_ASPECTS[ratio];
  if (!value) throw new RangeError(`Unsupported Flow image aspect ratio: ${ratio}`);
  return value;
}
function videoAspect(ratio: string): number {
  const value = FLOW_VIDEO_ASPECTS[ratio];
  if (!value) throw new RangeError(`Unsupported Flow video aspect ratio: ${ratio}`);
  return value;
}
function projectContext(projectId: string): unknown[] {
  if (!projectId) throw new TypeError('A Google Flow project is required to generate media.');
  return [null, 22, null, null, null, projectId, null, null, null, null, [CAPTCHA_SLOT, 1]];
}

export interface ImageRequestOptions {
  prompt: string;
  projectId: string;
  modelId: string;
  aspectRatio: string;
  outputCount: number;
  referenceIds?: string[];
  baseImageId?: string;
  seed?: number;
}

export function buildImageGenerationPayload(options: ImageRequestOptions): unknown[] {
  const { prompt, projectId, aspectRatio, outputCount, referenceIds = [], baseImageId } = options;
  const modelId = resolveImageBatchModel(options.modelId);
  if (!Number.isInteger(outputCount) || outputCount < 1 || outputCount > 4) throw new RangeError('Flow image count must be between one and four.');
  const ratio = imageAspect(aspectRatio);
  const seed = options.seed ?? Math.floor(Math.random() * 1_000_000_000) + 1;
  const imageInputs: unknown[] = [];
  if (baseImageId) imageInputs.push([baseImageId, null, null, null, 2]);
  for (const mediaId of referenceIds) if (mediaId && mediaId !== baseImageId) imageInputs.push([mediaId, null, null, null, 1]);
  const items = Array.from({ length: outputCount }, (_, index) => [
    null, null, imageInputs.length ? imageInputs : null, seed + index * 9973, ratio, modelId, null,
    projectContext(projectId), [[[prompt]]], null, null, null, uuid(), uuid(),
  ]);
  return [null, items, 1, projectContext(projectId), [uuid()]];
}

export function buildImageUploadPayload(input: { projectId: string; base64: string; mimeType: string; fileName: string }): unknown[] {
  if (!input.base64) throw new TypeError('An image is required for upload.');
  return [projectContext(input.projectId), input.base64, input.mimeType, 1, null, null, null, null, input.fileName, null, uuid(), uuid()];
}

export function buildTextVideoPayload(input: { prompt: string; projectId: string; modelId: string; aspectRatio: string }): unknown[] {
  return [[[
    [null, null, [[[input.prompt]]]], resolveVideoBatchModel(input.modelId, 'text'), videoAspect(input.aspectRatio), null,
    [null, null, null, null, uuid(), uuid()],
  ]], projectContext(input.projectId), [uuid(), 1]];
}

export function buildImageToVideoPayload(input: { prompt: string; projectId: string; modelId: string; aspectRatio: string; firstFrameId: string }): unknown[] {
  if (!input.firstFrameId) throw new TypeError('An uploaded first-frame image is required.');
  const request = [
    [null, null, [[[input.prompt]]]], resolveVideoBatchModel(input.modelId, 'image'), videoAspect(input.aspectRatio), null,
    [null, input.firstFrameId, null, null, null, FLOW_FULL_FRAME_CROP],
    [null, null, null, null, uuid(), uuid()],
  ];
  return [[request], projectContext(input.projectId), [uuid(), 2]];
}

export function buildReferenceVideoPayload(input: { prompt: string; projectId: string; modelId: string; aspectRatio: string; referenceIds: string[] }): unknown[] {
  if (!input.referenceIds.length) throw new TypeError('At least one uploaded reference image is required.');
  const request = [
    [null, null, [[[input.prompt]]]], input.referenceIds.map((id) => [null, id]), resolveVideoBatchModel(input.modelId, 'reference'),
    videoAspect(input.aspectRatio), null, [null, null, null, null, uuid(), uuid()],
  ];
  return [[request], projectContext(input.projectId), [uuid(), 2]];
}

export function buildOperationPayload(operationId: string): unknown[] { return [null, null, [[operationId]]]; }
export function buildProjectMediaPayload(projectId: string): unknown[] { return [`projects/${projectId}`, null, null, null, [1]]; }
export function buildMediaPayload(mediaId: string): unknown[] { return [mediaId]; }

function* nestedValues(node: unknown): Generator<unknown> {
  yield node;
  if (Array.isArray(node)) for (const child of node) yield* nestedValues(child);
}

export interface FlowMediaResult { mediaId: string; url: string; }

export function readGeneratedImages(payload: unknown): FlowMediaResult[] {
  const results = new Map<string, FlowMediaResult>();
  for (const item of nestedValues(payload)) {
    if (typeof item !== 'string' || !item.includes('flow-content.google/image/')) continue;
    try {
      const url = new URL(item);
      const match = url.pathname.match(/\/image\/([^/]+)/);
      if (url.protocol === 'https:' && url.hostname === 'flow-content.google' && match) results.set(match[1], { mediaId: match[1], url: item });
    } catch { /* Ignore non-URL strings in the RPC tree. */ }
  }
  return [...results.values()];
}

export function readUploadedMediaId(payload: unknown): string {
  const root = Array.isArray(payload) ? payload : [];
  const record = Array.isArray(root[0]) ? root[0] : [];
  const mediaId = record[0];
  if (typeof mediaId !== 'string' || !mediaId) throw new Error('Flow upload response did not include a media ID.');
  return mediaId;
}

export function readVideoOperation(payload: unknown): { mediaId: string; projectId: string; operationId: string; status: string | null } {
  const root = Array.isArray(payload) ? payload : [];
  const records = Array.isArray(root[3]) ? root[3] : [];
  const record = Array.isArray(records[0]) ? records[0] : [];
  if (typeof record[0] !== 'string' || !record[0]) throw new Error('Flow video response did not include a media ID.');
  return {
    mediaId: record[0],
    projectId: typeof record[1] === 'string' ? record[1] : '',
    operationId: typeof record[2] === 'string' ? record[2] : record[0],
    status: typeof record[3] === 'string' ? record[3] : null,
  };
}

export function readOperationStatus(payload: unknown): { operationId: string; projectId: string; status: string | null } {
  const root = Array.isArray(payload) ? payload : [];
  const records = Array.isArray(root[2]) ? root[2] : [];
  const record = Array.isArray(records[0]) ? records[0] : [];
  if (typeof record[0] !== 'string') throw new Error('Flow operation response did not include an operation ID.');
  return { operationId: record[0], projectId: typeof record[1] === 'string' ? record[1] : '', status: typeof record[3] === 'string' ? record[3] : null };
}

export function readMediaIdFromProjectResponse(text: string, operationId: string): string | null {
  const start = text.indexOf(operationId);
  if (start < 0) return null;
  const window = text.slice(start, start + 800);
  return window.match(/null,null,\\?"([0-9a-fA-F-]{36})\\?"/)?.[1] ?? null;
}

export const flowCaptchaPlaceholder = CAPTCHA_SLOT;
