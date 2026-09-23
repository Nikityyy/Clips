import en from '@/locales/en';
import de from '@/locales/de';
import type { Locale } from '@/shared/contracts';

export type TranslationKey = keyof typeof en;
export type MessageValues = Record<string, string | number>;

const dictionaries = { en, de } satisfies Record<Locale, Record<TranslationKey, string>>;

export function translate(locale: Locale, key: TranslationKey, values: MessageValues = {}): string {
  let message = dictionaries[locale]?.[key] ?? dictionaries.en[key];
  for (const [name, value] of Object.entries(values)) {
    message = message.replaceAll(`{${name}}`, String(value));
  }
  return message;
}

export function pluralCount(locale: Locale, count: number, oneKey: TranslationKey, otherKey: TranslationKey): string {
  const category = new Intl.PluralRules(locale).select(count);
  return translate(locale, category === 'one' ? oneKey : otherKey, { count: new Intl.NumberFormat(locale).format(count) });
}

export function dateTime(locale: Locale, value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return translate(locale, 'common.unknown');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function fileSize(locale: Locale, bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return translate(locale, 'common.unknown');
  if (bytes < 1000) return new Intl.NumberFormat(locale, { style: 'unit', unit: 'byte', unitDisplay: 'short', maximumFractionDigits: 0 }).format(bytes);
  const megabytes = bytes / 1_000_000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes)} MB`;
}

export function durationLabel(locale: Locale, milliseconds: number | null): string {
  if (milliseconds === null || milliseconds < 0) return translate(locale, 'common.unknown');
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(minutes) + ':' + new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(seconds);
}
