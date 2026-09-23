import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const userData = await mkdtemp(path.join(os.tmpdir(), 'clips-dev-seed-'));
let app;
try {
  app = await electron.launch({
    args: [path.join(root, 'out-electron', 'electron', 'main.js')],
    cwd: root,
    locale: 'en-US',
    timeout: 45_000,
    env: {
      ...process.env,
      CLIPS_TEST_PROVIDER: 'mock',
      CLIPS_TEST_USER_DATA: userData,
      CLIPS_DEV_SEED_EXAMPLES: '1',
      CLIPS_RENDERER_URL: 'http://localhost:3000',
    },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.clips), { timeout: 45_000 });
  const snapshot = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(snapshot.ok, 'development seed profile should open its library');
  const images = snapshot.data.assets.filter((asset) => asset.kind === 'image');
  const videos = snapshot.data.assets.filter((asset) => asset.kind === 'video');
  assert.equal(images.length, 6, 'development should preload six fictional reference images');
  assert.equal(videos.length, 1, 'development should preload a sample video');
  assert.equal(snapshot.data.characters.length, 1, 'development should preload a sample character');
  assert.equal(snapshot.data.characters[0].name, 'Mara');
  assert.equal(snapshot.data.characters[0].referenceAssetIds.length, 6, 'the sample character should have usable reference images');
  assert.ok(images.every((asset) => asset.provenance.provider === 'mock'), 'sample media should be clearly marked as local mock data');
  console.log('Development seed smoke test passed: six reference images, one sample video, and a linked character.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
