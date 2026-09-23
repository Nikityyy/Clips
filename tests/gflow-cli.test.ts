import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOOGLE_LOGIN_ENTRY_URL, parseFlowCatalog, parseFlowProfiles, parseFlowVerifiedAccount, isFlowSignInCancelled, parseGenerationPaths, patchGoogleLoginSources, UV_BUILDS } from '../electron/gflow-cli';

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

  it('starts sign-in at Google and redirects directly to Flow', () => {
    expect(GOOGLE_LOGIN_ENTRY_URL).toBe('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fflow.google.com%2F');
    const login = new URL(GOOGLE_LOGIN_ENTRY_URL);
    expect(login.hostname).toBe('accounts.google.com');
    expect(login.searchParams.get('continue')).toBe('https://flow.google.com/');
  });

  it('patches both pinned gflow browser strategies to open the direct Google sign-in page', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'clips-gflow-login-'));
    const auth = path.join(root, 'package-hash', 'gflow_cli', 'auth');
    try {
      await mkdir(auth, { recursive: true });
      const existingUrls = [
        'https://labs.google/fx/tools/flow?hl=en',
        'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Flabs.google%2Ffx%2Ftools%2Fflow%3Fhl%3Den',
      ];
      for (const [index, file] of ['internal_chromium.py', 'real_chrome.py'].entries()) {
        await writeFile(path.join(auth, file), `GEMINI_URL = "${existingUrls[index]}"\r\n`, 'utf8');
      }
      await expect(patchGoogleLoginSources(root)).resolves.toBe(2);
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

  it('recognizes closing Chrome before Flow confirms sign-in as cancellation', () => {
    expect(isFlowSignInCancelled('Launching Chrome... Authentication credential missing: No sign-in detected. Re-run gflow auth login.')).toBe(true);
    expect(isFlowSignInCancelled('Google Flow sign-in could not be completed because the network failed.')).toBe(false);
  });

  it('preserves the complete verified Google email address', () => {
    expect(parseFlowVerifiedAccount('\u001b[32mFlow session verified as person@gmail.com\u001b[0m\n')).toBe('person@gmail.com');
    expect(parseFlowVerifiedAccount('Flow session verified')).toBe('');
    expect(parseFlowVerifiedAccount('Authentication credential missing')).toBeNull();
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
