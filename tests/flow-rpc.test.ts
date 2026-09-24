import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { encodeFlowRpcEnvelope, FlowRpcClient, FlowRpcError, parseFlowBatchResponse } from '../electron/flow-rpc';
import { buildImageGenerationPayload, buildImageToVideoPayload, buildImageUploadPayload, buildReferenceVideoPayload, buildTextVideoPayload, isSupportedFlowBatchModel, readGeneratedImages, readOperationStatus, readUploadedMediaId, readVideoOperation, resolveImageBatchModel } from '../electron/flow-batch';

describe('Flow batchexecute codec', () => {
  it('builds the generic RPC envelope and keeps the payload JSON encoded once', () => {
    const envelope = JSON.parse(encodeFlowRpcEnvelope('abc123', { prompt: 'a cat' })) as unknown[];
    const call = (envelope[0] as unknown[])[0] as unknown[];
    expect(call[0]).toBe('abc123');
    expect(JSON.parse(call[1] as string)).toEqual({ prompt: 'a cat' });
    expect(() => encodeFlowRpcEnvelope('bad rpc id', {})).toThrow(/identifier/i);
  });

  it('parses a sentinel-prefixed response and unwraps the RPC payload', () => {
    const response = ")]}'\n9\n[[[\"wrb.fr\",\"abc123\",\"{\\\"ok\\\":true}\",null,null,null]]]";
    expect(parseFlowBatchResponse(response)).toEqual([{ rpcId: 'abc123', payload: { ok: true }, error: null }]);
  });

  it('returns explicit RPC errors instead of treating them as protocol success', () => {
    const response = '[[["wrb.fr","abc123",null,null,null,[5]]]]';
    expect(parseFlowBatchResponse(response)).toEqual([{ rpcId: 'abc123', payload: null, error: [5] }]);
  });
});

function clientFor(status: number, text: string) {
    const page = {
      isClosed: () => false,
      url: () => 'https://flow.google.com/',
      evaluate: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ status, text })),
    } as unknown as Page;
    return new FlowRpcClient(page);
}

describe('Flow RPC client', () => {
  it('sends through the connected Flow page and yields the matching result', async () => {
    const client = clientFor(200, '[[["wrb.fr","abc123","{\\"ok\\":true}",null,null,null]]]');
    await expect(client.call({ rpcId: 'abc123', payload: { prompt: 'test' } })).resolves.toEqual({ ok: true });
  });

  it('maps auth, quota, CAPTCHA, and protocol errors clearly', async () => {
    await expect(clientFor(401, '').call({ rpcId: 'abc123', payload: {} })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(clientFor(429, '').call({ rpcId: 'abc123', payload: {} })).rejects.toMatchObject({ code: 'QUOTA_REACHED' });
    await expect(clientFor(200, 'unrecognized').call({ rpcId: 'abc123', payload: {} })).rejects.toMatchObject({ code: 'PROTOCOL_CHANGED' });

    const page = {
      isClosed: () => false,
      url: () => 'https://flow.google.com/',
      evaluate: vi.fn<(...args: unknown[]) => Promise<never>>(async () => { throw new Error('CAPTCHA_API_UNAVAILABLE'); }),
    } as unknown as Page;
    await expect(new FlowRpcClient(page).call({ rpcId: 'abc123', payload: {}, captchaAction: 'IMAGE_GENERATION' }))
      .rejects.toMatchObject({ code: 'CAPTCHA_FAILED' });
  });

  it('does not retry an ambiguous submission automatically', async () => {
    const page = {
      isClosed: () => false,
      url: () => 'https://flow.google.com/',
      evaluate: vi.fn<(...args: unknown[]) => Promise<never>>(async () => { throw new Error('page.evaluate: Timeout 90000ms exceeded'); }),
    } as unknown as Page;
    const client = new FlowRpcClient(page);
    await expect(client.call({ rpcId: 'abc123', payload: {}, captchaAction: 'IMAGE_GENERATION' }))
      .rejects.toMatchObject<Partial<FlowRpcError>>({ code: 'FLOW_TIMEOUT', retryable: false });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});


describe('Flow generation request mapping', () => {
  it('maps only FlowKit-verified user-facing catalog aliases to current RPC model IDs', () => {
    expect(resolveImageBatchModel('nano-pro')).toBe('GEM_PIX_2');
    expect(resolveImageBatchModel('nano2')).toBe('NARWHAL');
    expect(isSupportedFlowBatchModel('image', ['image4'])).toBe(false);
    expect(isSupportedFlowBatchModel('video', ['omni-flash'])).toBe(true);
    expect(isSupportedFlowBatchModel('video', ['veo-quality'])).toBe(false);
    expect(() => resolveImageBatchModel('image4')).toThrow(/not verified/i);
  });

  it('builds image, upload, and video payloads with the chosen model and ratio', () => {
    const image = buildImageGenerationPayload({ prompt: 'A quiet forest', projectId: 'project', modelId: 'GEM_PIX_2', aspectRatio: '16:9', outputCount: 2, referenceIds: ['ref-1'] });
    expect(image[1]).toHaveLength(2);
    expect((image[1] as unknown[][])[0][5]).toBe('GEM_PIX_2');
    expect((image[1] as unknown[][])[0][4]).toBe(3);
    expect((image[1] as unknown[][])[0][5]).toBe('GEM_PIX_2');
    expect((image[1] as unknown[][])[0][2]).toEqual([['ref-1', null, null, null, 1]]);

    const upload = buildImageUploadPayload({ projectId: 'project', base64: 'ZGF0YQ==', mimeType: 'image/png', fileName: 'reference.png' });
    expect(upload[1]).toBe('ZGF0YQ==');
    expect(upload[2]).toBe('image/png');
    expect(buildTextVideoPayload({ prompt: 'A slow pan', projectId: 'project', modelId: 'abra_t2v_4s', aspectRatio: '9:16' })).toHaveLength(3);
    expect(buildImageToVideoPayload({ prompt: 'A slow pan', projectId: 'project', modelId: 'abra_i2v_8s', aspectRatio: '16:9', firstFrameId: 'frame' })).toHaveLength(3);
    expect(buildReferenceVideoPayload({ prompt: 'A slow pan', projectId: 'project', modelId: 'abra_r2v_8s', aspectRatio: '16:9', referenceIds: ['ref-a', 'ref-b'] })).toHaveLength(3);
  });

  it('rejects unsupported options instead of silently changing the request', () => {
    expect(() => buildImageGenerationPayload({ prompt: 'x', projectId: 'p', modelId: 'nano-pro', aspectRatio: '7:5', outputCount: 1 })).toThrow(/aspect ratio/i);
    expect(() => buildImageGenerationPayload({ prompt: 'x', projectId: 'p', modelId: 'nano-pro', aspectRatio: '1:1', outputCount: 5 })).toThrow(/count/i);
    expect(() => buildImageToVideoPayload({ prompt: 'x', projectId: 'p', modelId: 'm', aspectRatio: '16:9', firstFrameId: '' })).toThrow(/first-frame/i);
  });

  it('parses upload, image, video, and status responses defensively', () => {
    expect(readUploadedMediaId([['media-1', 'project-1']])).toBe('media-1');
    expect(readGeneratedImages(['https://flow-content.google/image/media-2?x=1'])).toEqual([{ mediaId: 'media-2', url: 'https://flow-content.google/image/media-2?x=1' }]);
    expect(readVideoOperation([null, null, null, [['media', 'project', 'operation', 'PROCESSING']]])).toEqual({ mediaId: 'media', projectId: 'project', operationId: 'operation', status: 'PROCESSING' });
    expect(readOperationStatus([null, null, [['operation', 'project', 'scene', 'CAE']]])).toEqual({ operationId: 'operation', projectId: 'project', status: 'CAE' });
  });
});
