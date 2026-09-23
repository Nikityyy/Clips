import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, IpcSchema, toAssetUri } from '../src/shared/contracts';

describe('renderer-to-main contracts', () => {
  it('keeps the sandboxed preload routes aligned with the shared IPC table', () => {
    const preload = readFileSync('electron/preload.ts', 'utf8');
    const block = preload.match(/const IPC_CHANNELS = \{([\s\S]*?)\} as const;/)?.[1];
    expect(block).toBeDefined();
    const entries = [...block!.matchAll(/^\s*(\w+):\s*'([^']+)'/gm)];
    expect(Object.fromEntries(entries.map(([, key, value]) => [key, value]))).toEqual(IPC_CHANNELS);
  });

  it('accepts a bounded image-generation request', () => {
    expect(IpcSchema.generate.safeParse({
      prompt: 'A quiet portrait in window light.',
      referenceAssetIds: ['asset_1'],
      modelId: 'mock-image',
      aspectRatio: '3:4',
      outputCount: 4,
    }).success).toBe(true);
  });

  it('rejects empty prompts, malformed ratios, extra fields, and excessive output counts', () => {
    for (const request of [
      { prompt: '   ' },
      { prompt: 'portrait', aspectRatio: 'ratio' },
      { prompt: 'portrait', outputCount: 7 },
      { prompt: 'portrait', filePath: 'C:/private/secret.png' },
    ]) {
      expect(IpcSchema.generate.safeParse(request).success).toBe(false);
    }
  });

  it('accepts only normalized locale and settings values', () => {
    expect(IpcSchema.settingsPatch.safeParse({ locale: 'de', outputCount: 2 }).success).toBe(true);
    expect(IpcSchema.settingsPatch.safeParse({ locale: 'fr' }).success).toBe(false);
    expect(IpcSchema.settingsPatch.safeParse({ outputCount: 0 }).success).toBe(false);
  });

  it('limits import batches and rejects path payloads with unexpected fields', () => {
    expect(IpcSchema.importPaths.safeParse({ paths: ['C:/Pictures/a.png'] }).success).toBe(true);
    expect(IpcSchema.importPaths.safeParse({ paths: Array.from({ length: 21 }, (_, i) => `C:/a${i}.png`) }).success).toBe(false);
    expect(IpcSchema.importPaths.safeParse({ paths: ['C:/a.png'], bytes: '...' }).success).toBe(false);
  });

  it('builds an opaque media URL from an asset id', () => {
    expect(toAssetUri('asset-123')).toBe('clips-media://asset/asset-123');
  });
});
