import { describe, expect, it } from 'vitest';
import { parseFlowCatalog, UV_BUILDS } from '../electron/flow-catalog';

const catalog = JSON.stringify({
  image: {
    models: [
      { name: 'Nano Banana 2', aliases: ['nano2', 'nano-banana-2'], ref_cap: 14, default: true },
      { name: 'Imagen 4', aliases: ['imagen4'], ref_cap: 0 },
    ],
    aspects: [{ ratio: '1:1', wire: 'SQUARE' }, { ratio: '4:3', wire: 'LANDSCAPE' }],
  },
  video: {
    models: [{ name: 'Veo Fast', aliases: ['veo-fast'], ref_cap: 3, max_duration: 8 }],
    aspects: [{ ratio: '9:16', wire: 'PORTRAIT' }, { ratio: '16:9', wire: 'LANDSCAPE' }],
  },
});

describe('live Flow model catalog', () => {

  it('ships the expected uv executable metadata', () => {
    expect(UV_BUILDS['win32-x64'].executable).toBe('uv.exe');
  });

  it('uses the connector catalog for models, aliases, reference caps, and aspect options', () => {
    expect(parseFlowCatalog(catalog)).toEqual({
      models: [
        { id: 'nano2', label: 'Nano Banana 2', kind: 'image', aliases: ['nano2', 'nano-banana-2'], referenceCap: 14, maxDuration: null },
        { id: 'imagen4', label: 'Imagen 4', kind: 'image', aliases: ['imagen4'], referenceCap: 0, maxDuration: null },
        { id: 'veo-fast', label: 'Veo 3.1 Fast', kind: 'video', aliases: ['veo-fast'], referenceCap: 3, maxDuration: 8 },
      ],
      imageAspectRatios: ['1:1', '4:3'],
      videoAspectRatios: ['9:16', '16:9'],
    });
  });

  it('shows product model names while keeping connector aliases as generation IDs', () => {
    const modelCatalog = parseFlowCatalog(JSON.stringify({
      image: {
        models: [
          { name: 'NARWHAL', aliases: ['nano2', 'nano-banana-2'], ref_cap: 10 },
          { name: 'GEM_PIX_2', aliases: ['nano-pro'], ref_cap: 10 },
          { name: 'IMAGEN_3_5', aliases: ['image4'], ref_cap: 3 },
        ],
        aspects: [{ ratio: '1:1' }],
      },
      video: {
        models: [{ name: 'VEO_3_1_QUALITY', aliases: ['veo-quality'], ref_cap: 3 }],
        aspects: [{ ratio: '16:9' }],
      },
    }));
    expect(modelCatalog.models.map(({ id, label }) => [id, label])).toEqual([
      ['nano2', 'Nano Banana 2'],
      ['nano-pro', 'Nano Banana Pro'],
      ['image4', 'Imagen 4'],
      ['veo-quality', 'Veo 3.1 Quality'],
    ]);
  });

  it('fails clearly when the connector has no complete image/video model catalog', () => {
    expect(() => parseFlowCatalog(JSON.stringify({ image: { models: [], aspects: [] } }))).toThrow(/image and video models/i);
    expect(() => parseFlowCatalog(JSON.stringify({ image: { models: [{ name: 'I', aliases: ['i'], ref_cap: 0 }], aspects: [] }, video: { models: [{ name: 'V', aliases: ['v'], ref_cap: 0 }], aspects: [] } }))).toThrow(/aspect-ratio options/i);
  });

});
