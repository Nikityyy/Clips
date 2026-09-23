import type { Asset, JobKind } from '@/shared/contracts';
import type { TranslationKey } from '@/lib/i18n';

export type View = 'create' | 'library' | 'characters' | 'queue' | 'settings' | 'profile';
export type CreateMode = JobKind;
export type Notice = {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  tone?: 'neutral' | 'error';
};
export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;
export type AssetAction = (asset: Asset) => void;
