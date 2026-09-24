import { describe, expect, it } from 'vitest';
import type { AssetProvenance, AssetSource } from '../src/shared/contracts';
import { characterReferenceIds, isGeneratedAsset, manualReferenceCapacity } from '../src/shared/asset-origin';

const provenance = (source: AssetSource): AssetProvenance => ({
  source,
  provider: null,
  accountId: null,
  jobId: null,
  prompt: null,
  model: null,
  sourceAssetIds: [],
  characterIds: [],
  createdAt: '',
});

describe('asset origin', () => {
  it.each(['flow-handoff', 'flow-generation'] as const)('marks %s as generated', (source) => {
    expect(isGeneratedAsset({ provenance: provenance(source) })).toBe(true);
  });

  it.each(['import', 'clipboard', 'mock'] as const)('marks %s as imported', (source) => {
    expect(isGeneratedAsset({ provenance: provenance(source) })).toBe(false);
  });

  it('marks a mock result with a job id as generated', () => {
    expect(isGeneratedAsset({ provenance: { ...provenance('mock'), jobId: 'job-1' } })).toBe(true);
  });

  it('counts a character portrait once when it is also one of its references', () => {
    expect(characterReferenceIds({ referenceAssetIds: ['ref-a', 'portrait', 'ref-a'], portraitAssetId: 'portrait' })).toEqual(['ref-a', 'portrait']);
  });

  it('reserves the character references and caps manual selections at the draft limit', () => {
    const character = { referenceAssetIds: ['a', 'b'], portraitAssetId: 'portrait' };
    expect(manualReferenceCapacity(character, 10)).toBe(7);
    expect(manualReferenceCapacity(character, 2)).toBe(0);
    expect(manualReferenceCapacity(null, 16)).toBe(12);
  });
});
