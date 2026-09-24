import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { GoogleFlowProvider } from '../electron/flow-provider';
import type { FlowRpcClient, FlowRpcRequest } from '../electron/flow-rpc';

const IMAGE_URL = 'https://flow-content.google/image/generated-image?signature=fake';
const VIDEO_URL = 'https://flow-content.google/video/generated-video?signature=fake';
const originalFetch = globalThis.fetch;

function mockPage(): Page {
  return { isClosed: () => false, url: () => 'https://flow.google.com/' } as unknown as Page;
}

function mockRpc(responses: unknown[]) {
  const call = vi.fn<(request: FlowRpcRequest) => Promise<unknown>>(async (_request) => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { client: { call } as unknown as FlowRpcClient, call };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('GoogleFlowProvider', () => {
  it('sends a mocked image request once and imports no real Flow state', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'clips-flow-provider-'));
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(256).fill(7), { status: 200 })) as typeof fetch;
    const rpc = mockRpc([[IMAGE_URL]]);
    try {
      const provider = new GoogleFlowProvider(mockPage(), rpc.client);
      const files = await provider.generateImages({
        projectId: 'project-id', prompt: 'A quiet forest', modelId: 'GEM_PIX_2',
        aspectRatio: '16:9', count: 1, inputPaths: [], outputDirectory,
      });
      expect(files).toHaveLength(1);
      expect((await readFile(files[0])).byteLength).toBe(256);
      expect(rpc.call).toHaveBeenCalledTimes(1);
      expect(rpc.call.mock.calls[0][0]).toMatchObject({ rpcId: 'ogiZ0b', captchaAction: 'IMAGE_GENERATION' });
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  it('uses mocked upload, video submit, status poll and download without retrying generation', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'clips-flow-video-'));
    const inputDirectory = await mkdtemp(path.join(os.tmpdir(), 'clips-flow-input-'));
    const referencePath = path.join(inputDirectory, 'reference.png');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(referencePath, new Uint8Array([1, 2, 3, 4]));
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response(new Uint8Array(512).fill(3), { status: 200 })) as typeof fetch;
    const rpc = mockRpc([
      [['uploaded-media-id', 'project-id', 'upload-op', 'CAE']],
      [null, null, null, [['generated-media-id', 'project-id', 'operation-id', 'RUNNING']]],
      [null, null, [['operation-id', 'project-id', 'scene-id', 'CAE']]],
      [VIDEO_URL],
    ]);
    try {
      const provider = new GoogleFlowProvider(mockPage(), rpc.client, 0);
      const files = await provider.generateVideo({
        projectId: 'project-id', prompt: 'A slow pan', modelId: 'abra_i2v_8s',
        aspectRatio: '9:16', inputPaths: [referencePath], outputDirectory,
      });
      expect(files).toHaveLength(1);
      expect((await readFile(files[0])).byteLength).toBe(512);
      expect(rpc.call.mock.calls.map(([request]) => request.rpcId)).toEqual(['maseQ', 'eb1hJf', 'jwpduf', 'as29s']);
      expect(rpc.call.mock.calls.filter(([request]) => ['eb1hJf', 'YhhmEf', 'MZZa6b'].includes(request.rpcId))).toHaveLength(1);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
      await rm(inputDirectory, { recursive: true, force: true });
    }
  });

  it('rejects an untrusted media download host', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'clips-flow-host-'));
    const rpc = mockRpc([['https://example.com/image/not-flow']]);
    try {
      const provider = new GoogleFlowProvider(mockPage(), rpc.client);
      await expect(provider.generateImages({
        projectId: 'project-id', prompt: 'No generation', modelId: 'GEM_PIX_2',
        aspectRatio: '1:1', count: 1, inputPaths: [], outputDirectory,
      })).rejects.toThrow(/no downloadable images/i);
      expect(globalThis.fetch).toBe(originalFetch);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
