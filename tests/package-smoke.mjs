import assert from 'node:assert/strict';
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
  const snapshot = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(snapshot.ok, 'packaged app should open its local database');
  assert.ok(snapshot.data.assets.length >= 6, 'packaged app should load bundled local fixtures');
  assert.ok(snapshot.data.characters.some((character) => character.name === 'Mara'));
  try {
    await page.waitForFunction(() => {
      const previews = [...document.querySelectorAll('.result-card img')];
      return previews.length >= 6 && previews.every((image) => image.complete && image.naturalWidth > 0);
    }, { timeout: 10_000 });
  } catch {
    const previewState = await page.evaluate(() => ({
      url: location.href,
      count: document.querySelectorAll('.result-card img').length,
      images: [...document.querySelectorAll('.result-card img')].map((image) => ({ src: image.src, complete: image.complete, width: image.naturalWidth })),
      body: document.body.innerText.slice(0, 700),
    }));
    throw new Error(`Packaged media preview failed: ${JSON.stringify({ previewState, rendererErrors })}`);
  }
  assert.deepEqual(rendererErrors, [], `packaged renderer errors: ${rendererErrors.join('; ')}`);
  console.log('Packaged app smoke test passed: isolated profile, SQLite startup, bundled assets, and local media protocol.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(isolation, { recursive: true, force: true });
}
