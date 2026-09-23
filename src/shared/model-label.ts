const friendlyNames: Record<string, string> = {
  narwhal: 'Nano Banana 2',
  nano2: 'Nano Banana 2',
  'nano-banana-2': 'Nano Banana 2',
  'nano2-lite': 'Nano Banana 2 Lite',
  'nano-banana-2-lite': 'Nano Banana 2 Lite',
  gem_pix_2: 'Nano Banana Pro',
  'gem-pix-2': 'Nano Banana Pro',
  'nano-pro': 'Nano Banana Pro',
  nanopro: 'Nano Banana Pro',
  imagen_3_5: 'Imagen 4',
  'imagen-3-5': 'Imagen 4',
  image4: 'Imagen 4',
  imagen4: 'Imagen 4',
  'omni-flash': 'Omni 1.1 Flash',
  'veo-lite': 'Veo 3.1 Lite',
  'veo-lite-lp': 'Veo 3.1 Lite · lower priority',
  'veo-fast': 'Veo 3.1 Fast',
  'veo-quality': 'Veo 3.1 Quality',
};

/** Resolves connector aliases/internal enums to readable product names for UI only. */
export function friendlyModelName(value: string): string | null {
  return friendlyNames[value.trim().toLowerCase()] ?? null;
}

export function readableModelFallback(value: string): string {
  return value.replace(/[_-]+/g, ' ').toLocaleLowerCase().replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}
