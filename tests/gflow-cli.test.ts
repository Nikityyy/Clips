import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOOGLE_LOGIN_ENTRY_URL, parseFlowCatalog, parseFlowProfiles, parseGenerationPaths, patchGoogleLoginSources, UV_BUILDS } from '../electron/gflow-cli';

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

describe('gflow-cli adapter data', () => {

  it('starts sign-in at Google and redirects back to the Flow editor', () => {
    const login = new URL(GOOGLE_LOGIN_ENTRY_URL);
    expect(login.hostname).toBe('accounts.google.com');
    expect(login.searchParams.get('continue')).toBe('https://labs.google/fx/tools/flow?hl=en');
  });

  it('patches both pinned gflow browser strategies to open the direct Google sign-in page', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'clips-gflow-login-'));
    const auth = path.join(root, 'package-hash', 'gflow_cli', 'auth');
    try {
      await mkdir(auth, { recursive: true });
      for (const file of ['internal_chromium.py', 'real_chrome.py']) {
        await writeFile(path.join(auth, file), 'GEMINI_URL = "https://labs.google/fx/tools/flow?hl=en"\r\n', 'utf8');
      }
      await expect(patchGoogleLoginSources(root)).resolves.toBe(2);
      for (const file of ['internal_chromium.py', 'real_chrome.py']) {
        await expect(readFile(path.join(auth, file), 'utf8')).resolves.toContain(`GEMINI_URL = "${GOOGLE_LOGIN_ENTRY_URL}"`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('looks for Windows uv.exe at the root of Astral’s official zip archive', () => {
    expect(UV_BUILDS['win32-x64'].executable).toBe('uv.exe');
  });

  it('uses the connector catalog for models, aliases, reference caps, and aspect options', () => {
    expect(parseFlowCatalog(catalog)).toEqual({
      models: [
        { id: 'nano2', label: 'Nano Banana 2', kind: 'image', aliases: ['nano2', 'nano-banana-2'], referenceCap: 14, maxDuration: null },
        { id: 'imagen4', label: 'Imagen 4', kind: 'image', aliases: ['imagen4'], referenceCap: 0, maxDuration: null },
        { id: 'veo-fast', label: 'Veo Fast', kind: 'video', aliases: ['veo-fast'], referenceCap: 3, maxDuration: 8 },
      ],
      imageAspectRatios: ['1:1', '4:3'],
      videoAspectRatios: ['9:16', '16:9'],
    });
  });

  it('fails clearly when the connector has no complete image/video model catalog', () => {
    expect(() => parseFlowCatalog(JSON.stringify({ image: { models: [], aspects: [] } }))).toThrow(/image and video models/i);
    expect(() => parseFlowCatalog(JSON.stringify({ image: { models: [{ name: 'I', aliases: ['i'], ref_cap: 0 }], aspects: [] }, video: { models: [{ name: 'V', aliases: ['v'], ref_cap: 0 }], aspects: [] } }))).toThrow(/aspect-ratio options/i);
  });

  it('reads only the selected gflow profile metadata', () => {
    expect(parseFlowProfiles(JSON.stringify([
      { name: 'clips', google_account: 'person@example.com', is_default: false, cookies_present: true, profile_dir: 'private-path' },
      { name: 'other', google_account: null, is_default: true, cookies_present: false },
      { ignored: true },
    ]))).toEqual([
      { name: 'clips', google_account: 'person@example.com', is_default: false, cookies_present: true },
      { name: 'other', google_account: null, is_default: true, cookies_present: false },
    ]);
  });

  it('extracts local generation files from gflow JSON output', () => {
    expect(parseGenerationPaths(JSON.stringify({ status: 'ok', count: 2, images: [
      { local_path: 'C:\\clips\\flow\\one.png' },
      { local_path: 'C:\\clips\\flow\\two.png' },
    ] }), 'image')).toEqual(['C:\\clips\\flow\\one.png', 'C:\\clips\\flow\\two.png']);
    expect(parseGenerationPaths(JSON.stringify({ status: 'ok', local_path: '/tmp/clip.mp4' }), 'video')).toEqual(['/tmp/clip.mp4']);
  });

  it('surfaces connector generation failures instead of treating them as empty output', () => {
    expect(() => parseGenerationPaths(JSON.stringify({ status: 'fail', error_message: 'Session expired' }), 'video')).toThrow(/Session expired/i);
  });
});
