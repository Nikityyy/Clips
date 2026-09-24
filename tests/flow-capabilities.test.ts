import { describe, expect, it } from 'vitest';
import { mapFlowCapabilities } from '../electron/flow-capabilities';
import type { FlowCatalog } from '../electron/flow-catalog';

const catalog: FlowCatalog = {
  models: [
    { id: 'nano-pro', label: 'Nano Banana Pro', kind: 'image', aliases: ['nano-pro'], referenceCap: 10, maxDuration: null },
    { id: 'nano2', label: 'Nano Banana 2', kind: 'image', aliases: ['nano2'], referenceCap: 10, maxDuration: null },
    { id: 'image4', label: 'Imagen 4', kind: 'image', aliases: ['image4'], referenceCap: 0, maxDuration: null },
    { id: 'omni-flash', label: 'Omni 1.1 Flash', kind: 'video', aliases: ['omni-flash'], referenceCap: 10, maxDuration: 10 },
    { id: 'veo-fast', label: 'Veo 3.1 Fast', kind: 'video', aliases: ['veo-fast'], referenceCap: 10, maxDuration: 8 },
  ],
  imageAspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4', '7:5'],
  videoAspectRatios: ['9:16', '16:9', '1:1'],
};

describe('Flow capability mapper', () => {
  it('keeps live friendly labels while filtering options with no verified RPC mapping', () => {
    const result = mapFlowCapabilities(catalog, 'clips', 'ready', 'Connected');
    expect(result.models.map(({ id, label }) => [id, label])).toEqual([
      ['nano-pro', 'Nano Banana Pro'], ['nano2', 'Nano Banana 2'], ['omni-flash', 'Omni 1.1 Flash'],
    ]);
    expect(result.imageAspectRatios).toEqual(['9:16', '16:9', '1:1', '4:3', '3:4']);
    expect(result.videoAspectRatios).toEqual(['9:16', '16:9']);
    expect(result.supportsImageToVideo).toBe(true);
  });
});
