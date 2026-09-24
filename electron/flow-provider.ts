import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { FLOW_CAPTCHA, FLOW_RPC, buildImageGenerationPayload, buildImageToVideoPayload, buildImageUploadPayload, buildOperationPayload, buildProjectMediaPayload, buildReferenceVideoPayload, buildTextVideoPayload, readGeneratedImages, readMediaIdFromProjectResponse, readOperationStatus, readUploadedMediaId, readVideoOperation } from './flow-batch';
import { FlowRpcClient } from './flow-rpc';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function findUuid(value: unknown): string | null {
  if (typeof value === 'string') return value.match(UUID_PATTERN)?.[0] ?? null;
  if (Array.isArray(value)) for (const child of value) { const found = findUuid(child); if (found) return found; }
  if (value && typeof value === 'object') for (const child of Object.values(value)) { const found = findUuid(child); if (found) return found; }
  return null;
}

function projectIdFromUrl(url: string): string | null {
  try { return new URL(url).pathname.match(/\/project\/([0-9a-f-]{36})/i)?.[1] ?? null; } catch { return null; }
}

/** Flow-specific project bootstrap and RPC generation. It never drives the composer UI. */
export class GoogleFlowProvider {
  constructor(private readonly page: Page, private readonly rpc = new FlowRpcClient(page), private readonly pollIntervalMs = 4_000) {}

  async ensureProject(existingProjectId?: string | null): Promise<string> {
    if (existingProjectId) return existingProjectId;
    const active = projectIdFromUrl(this.page.url());
    if (active) return active;

    // Keep Clips' generations in a dedicated Flow project. The migrated Flow
    // host no longer offers a supported project-create RPC, so this one setup
    // click is the only Flow UI interaction in the generation path.
    const created = this.page.waitForResponse((response) => {
      const url = response.url();
      return url.includes('/batchexecute') && new URL(url).searchParams.get('rpcids') === 'jHPbke';
    }, { timeout: 30_000 }).catch(() => null);
    const buttons = this.page.getByRole('button');
    const count = await buttons.count();
    let clicked = false;
    for (let index = 0; index < Math.min(count, 100); index += 1) {
      const button = buttons.nth(index);
      const label = `${await button.getAttribute('aria-label') ?? ''} ${await button.getAttribute('title') ?? ''} ${await button.innerText().catch(() => '')}`;
      if (/new project|create project|add project|projekt erstellen|neues projekt|projekt hinzufügen/i.test(label)) {
        await button.click({ timeout: 5000 });
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      await this.page.bringToFront().catch(() => undefined);
      throw new Error('Flow needs a one-time project setup. Finish the notice shown in its browser window, then try again.');
    }

    const response = await created;
    const responseText = response ? await response.text().catch(() => '') : '';
    const responseProjectId = responseText.match(/projects\/([0-9a-f-]{36})/i)?.[1] ?? findUuid(responseText);
    if (responseProjectId) return responseProjectId;
    await this.page.waitForURL((url) => Boolean(projectIdFromUrl(url.href)), { timeout: 20_000 }).catch(() => undefined);
    const urlProjectId = projectIdFromUrl(this.page.url());
    if (urlProjectId) return urlProjectId;
    await this.page.bringToFront().catch(() => undefined);
    throw new Error('Flow did not finish creating its project. Complete any setup prompt in its browser window, then try again.');
  }

  async uploadImage(projectId: string, filePath: string): Promise<string> {
    const bytes = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = ({ '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif' } as Record<string, string>)[extension] ?? 'image/jpeg';
    const payload = buildImageUploadPayload({ projectId, base64: bytes.toString('base64'), mimeType, fileName: path.basename(filePath) });
    const result = await this.rpc.call<unknown>({ rpcId: FLOW_RPC.uploadImage, payload, captchaAction: FLOW_CAPTCHA.image });
    return readUploadedMediaId(result);
  }

  async generateImages(input: {
    projectId: string; prompt: string; modelId: string; aspectRatio: string; count: number; inputPaths: string[]; outputDirectory: string;
    onProgress?: (progress: number, stage: string) => void;
  }): Promise<string[]> {
    const referenceIds: string[] = [];
    for (const [index, filePath] of input.inputPaths.entries()) {
      input.onProgress?.(5 + ((index + 1) / input.inputPaths.length) * 15, `Uploading reference ${index + 1} of ${input.inputPaths.length}`);
      referenceIds.push(await this.uploadImage(input.projectId, filePath));
    }
    input.onProgress?.(25, 'Generating image');
    const payload = buildImageGenerationPayload({
      projectId: input.projectId,
      prompt: input.prompt,
      modelId: input.modelId,
      aspectRatio: input.aspectRatio,
      outputCount: input.count,
      referenceIds,
    });
    const result = await this.rpc.call<unknown>({ rpcId: FLOW_RPC.generateImage, payload, captchaAction: FLOW_CAPTCHA.image });
    input.onProgress?.(85, 'Preparing generated images');
    const images = readGeneratedImages(result);
    if (!images.length) throw new Error('Flow accepted the image request but returned no downloadable images.');
    await fs.mkdir(input.outputDirectory, { recursive: true });
    const outputs: string[] = [];
    for (const [index, image] of images.entries()) {
      outputs.push(await this.download(image.url, path.join(input.outputDirectory, `flow-image-${index + 1}.jpg`)));
    }
    return outputs;
  }

  async generateVideo(input: {
    projectId: string; prompt: string; modelId: string; aspectRatio: string; inputPaths: string[]; outputDirectory: string;
    onProgress?: (progress: number, stage: string) => void;
  }): Promise<string[]> {
    const uploaded: string[] = [];
    for (const [index, filePath] of input.inputPaths.entries()) {
      input.onProgress?.(5 + ((index + 1) / input.inputPaths.length) * 15, `Uploading reference ${index + 1} of ${input.inputPaths.length}`);
      uploaded.push(await this.uploadImage(input.projectId, filePath));
    }
    input.onProgress?.(25, 'Starting video generation');
    const payload = uploaded.length === 0
      ? buildTextVideoPayload({ projectId: input.projectId, prompt: input.prompt, modelId: input.modelId, aspectRatio: input.aspectRatio })
      : uploaded.length === 1
        ? buildImageToVideoPayload({ projectId: input.projectId, prompt: input.prompt, modelId: input.modelId, aspectRatio: input.aspectRatio, firstFrameId: uploaded[0] })
        : buildReferenceVideoPayload({ projectId: input.projectId, prompt: input.prompt, modelId: input.modelId, aspectRatio: input.aspectRatio, referenceIds: uploaded });
    const rpcId = uploaded.length === 0 ? FLOW_RPC.generateTextVideo : uploaded.length === 1 ? FLOW_RPC.generateVideo : FLOW_RPC.generateReferenceVideo;
    const result = await this.rpc.call<unknown>({ rpcId, payload, captchaAction: FLOW_CAPTCHA.video });
    const operation = readVideoOperation(result);
    await fs.mkdir(input.outputDirectory, { recursive: true });
    const outputPath = path.join(input.outputDirectory, 'flow-video.mp4');
    const deadline = Date.now() + 15 * 60_000;
    let lastStatus = operation.status;
    const pollStartedAt = Date.now();
    while (Date.now() < deadline) {
      if (lastStatus === 'CAE') {
        const media = await this.rpc.call<unknown>({ rpcId: FLOW_RPC.media, payload: [operation.mediaId] });
        const videoUrl = findHttpsMediaUrl(media, 'video');
        if (!videoUrl) break;
        input.onProgress?.(92, 'Downloading video');
        return [await this.download(videoUrl, outputPath)];
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      const statusResult = await this.rpc.call<unknown>({ rpcId: FLOW_RPC.operation, payload: buildOperationPayload(operation.operationId) });
      lastStatus = readOperationStatus(statusResult).status;
      input.onProgress?.(Math.min(88, 27 + ((Date.now() - pollStartedAt) / (15 * 60_000)) * 61), 'Generating video');
    }
    // The operation can reach its terminal state before the signed media URL
    // is indexed; the project listing is the authoritative final lookup.
    const listing = await this.rpc.call<unknown>({ rpcId: FLOW_RPC.projectMedia, payload: buildProjectMediaPayload(input.projectId) });
    const mediaId = findProjectMediaId(listing, operation.operationId);
    if (!mediaId) throw new Error('Flow is still processing this video. Its status will be checked again before retrying.');
    const media = await this.rpc.call<unknown>({ rpcId: FLOW_RPC.media, payload: [mediaId] });
    const videoUrl = findHttpsMediaUrl(media, 'video');
    if (!videoUrl) throw new Error('Flow finished the video but did not provide a download link.');
    input.onProgress?.(92, 'Downloading video');
    return [await this.download(videoUrl, outputPath)];
  }

  private async download(url: string, outputPath: string): Promise<string> {
    const mediaUrl = new URL(url);
    if (mediaUrl.protocol !== 'https:' || mediaUrl.hostname !== 'flow-content.google') throw new Error('Flow returned an untrusted media download URL.');
    const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Flow media download failed (HTTP ${response.status}).`);
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length < 100) throw new Error('Flow returned an empty media file.');
    await fs.writeFile(outputPath, body, { flag: 'wx' }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
      await fs.writeFile(outputPath, body);
    });
    return outputPath;
  }
}

function findHttpsMediaUrl(value: unknown, type: 'image' | 'video'): string | null {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && url.hostname === 'flow-content.google' && url.pathname.includes(`/${type}/`)) return value;
    } catch { return null; }
  }
  if (Array.isArray(value)) for (const child of value) { const found = findHttpsMediaUrl(child, type); if (found) return found; }
  if (value && typeof value === 'object') for (const child of Object.values(value)) { const found = findHttpsMediaUrl(child, type); if (found) return found; }
  return null;
}

function findProjectMediaId(value: unknown, operationId: string): string | null {
  if (Array.isArray(value)) {
    if (value[0] === operationId && Array.isArray(value[3]) && typeof value[3][4] === 'string') return value[3][4];
    for (const child of value) { const found = findProjectMediaId(child, operationId); if (found) return found; }
  }
  if (value && typeof value === 'object') for (const child of Object.values(value)) { const found = findProjectMediaId(child, operationId); if (found) return found; }
  if (typeof value === 'string') return readMediaIdFromProjectResponse(value, operationId);
  return null;
}
