import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const isolation = await mkdtemp(path.join(os.tmpdir(), 'clips-package-smoke-'));
const executablePath = process.platform === 'win32'
  ? path.join(root, 'release', 'win-unpacked', 'Clips.exe')
  : process.platform === 'darwin'
    ? path.join(root, 'release', 'mac', 'Clips.app', 'Contents', 'MacOS', 'Clips')
    : path.join(root, 'release', 'linux-unpacked', 'Clips');
const localEnv = { CLIPS_TEST_PACKAGED_USER_DATA: isolation };

let app;
try {
  app = await electron.launch({ executablePath, cwd: root, timeout: 45_000, env: { ...process.env, ...localEnv } });
  const page = await app.firstWindow();
  const rendererErrors = [];
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') rendererErrors.push(message.text()); });
  await page.waitForFunction(() => Boolean(window.clips), { timeout: 45_000 });
  const runtime = await app.evaluate(({ app: electronApp }) => ({ packaged: electronApp.isPackaged, userData: electronApp.getPath('userData') }));
  assert.equal(runtime.packaged, true);
  assert.equal(path.resolve(runtime.userData).toLowerCase(), path.resolve(isolation).toLowerCase());
  assert.equal(existsSync(path.join(root, 'out', 'media', 'mock')), false, 'the packaged renderer should not contain development sample media');
  assert.equal(existsSync(path.join(root, 'fixtures', 'dev-media')), true, 'development fixtures should remain available to the source workspace');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('500 14px "Manrope Variable"')), true, 'the packaged app should load the bundled Manrope font');
  assert.equal(await page.locator('.brand-mark svg.lucide-clapperboard').count(), 1, 'the packaged app should show Lucide’s Clapperboard icon');
  const snapshot = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(snapshot.ok, 'packaged app should open its local database');
  assert.equal(snapshot.data.assets.length, 0, 'a new packaged app should start with an empty media library');
  assert.equal(snapshot.data.characters.length, 0, 'a new packaged app should not preload example characters');
  assert.ok(snapshot.data.capabilities.models.length === 0 || snapshot.data.capabilities.provider === 'google-flow', 'the installed app should use Google Flow, never bundled mock models');
  await page.locator('.canvas-title-block h1').waitFor({ state: 'visible' });
  assert.deepEqual(rendererErrors, [], `packaged renderer errors: ${rendererErrors.join('; ')}`);
  console.log('Packaged app smoke test passed: isolated profile, empty first-run library, Flow-only provider, and renderer startup.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(isolation, { recursive: true, force: true });
}
