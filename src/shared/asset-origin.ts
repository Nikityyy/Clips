import type { Asset, Character } from '@/shared/contracts';

export function isGeneratedAsset(asset: Pick<Asset, 'provenance'>): boolean {
  const source = asset.provenance.source;
  return Boolean(asset.provenance.jobId) || source === 'flow-handoff' || source === 'flow-generation';
}

export function characterReferenceIds(character: Pick<Character, 'referenceAssetIds' | 'portraitAssetId'> | null | undefined): string[] {
  if (!character) return [];
  return [...new Set([...character.referenceAssetIds, ...(character.portraitAssetId ? [character.portraitAssetId] : [])])];
}

export function manualReferenceCapacity(character: Pick<Character, 'referenceAssetIds' | 'portraitAssetId'> | null | undefined, referenceCap: number): number {
  return Math.max(0, Math.min(12, referenceCap - characterReferenceIds(character).length));
}
