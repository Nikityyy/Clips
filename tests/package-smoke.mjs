import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { listPackage } from '@electron/asar';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const isolation = await mkdtemp(path.join(os.tmpdir(), 'clips-package-smoke-'));
const packageDirectory = process.platform === 'win32'
  ? path.join(root, 'release', 'win-unpacked')
  : process.platform === 'darwin'
    ? path.join(root, 'release', 'mac', 'Clips.app', 'Contents', 'Resources')
    : path.join(root, 'release', 'linux-unpacked');
const executablePath = process.platform === 'win32'
  ? path.join(packageDirectory, 'Clips.exe')
  : process.platform === 'darwin'
    ? path.join(root, 'release', 'mac', 'Clips.app', 'Contents', 'MacOS', 'Clips')
    : path.join(packageDirectory, 'Clips');
const archivePath = process.platform === 'darwin'
  ? path.join(packageDirectory, 'app.asar')
  : path.join(packageDirectory, 'resources', 'app.asar');
const localEnv = { CLIPS_TEST_PACKAGED_USER_DATA: isolation };
assert.equal(existsSync(path.join(packageDirectory, 'resources', 'flow-runtime-spec.json')), true, 'the Windows installer should include the pinned runtime manifest without bundling the runtime payload');

let app;
try {
  app = await electron.launch({ executablePath, cwd: root, timeout: 45_000, env: { ...process.env, ...localEnv } });
  const page = await app.firstWindow();
  const rendererErrors = [];
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') rendererErrors.push(message.text()); });
  await page.waitForFunction(() => Boolean(window.clips), { timeout: 45_000 });
  await page.getByRole('button', { name: /Skip setup|Einrichtung überspringen/ }).click();
  await page.locator('.startup-consent').waitFor({ timeout: 45_000 });
  const runtime = await app.evaluate(({ app: electronApp }) => ({ packaged: electronApp.isPackaged, userData: electronApp.getPath('userData') }));
  assert.equal(runtime.packaged, true);
  assert.equal(path.resolve(runtime.userData).toLowerCase(), path.resolve(isolation).toLowerCase());
  assert.equal(existsSync(path.join(runtime.userData, 'runtime')), false, 'opening a fresh packaged app should not prepare the Flow runtime before the user accepts its notice');
  const packagedFiles = listPackage(archivePath, { isPack: false }).map((file) => file.replaceAll('\\', '/').replace(/^\/+/, ''));
  const fixtureFiles = packagedFiles.filter((file) => /(?:^|\/)(?:fixtures\/dev-media|media\/mock)(?:\/|$)/i.test(file));
  const productionPackages = packagedFiles.filter((file) => file.startsWith('node_modules/')).map((file) => file.split('/').slice(0, 2).join('/'));
  const uniqueProductionPackages = [...new Set(productionPackages)];
  assert.deepEqual(uniqueProductionPackages.toSorted(), ['node_modules/sql.js', 'node_modules/zod'], 'the packaged app should include only main-process runtime dependencies');
  assert.deepEqual(fixtureFiles, [], 'the installer archive should contain no development example media');
  assert.equal(existsSync(path.join(root, 'fixtures', 'dev-media')), true, 'development fixtures should remain available to the source workspace');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('500 14px "Manrope Variable"')), true, 'the packaged app should load the bundled Manrope font');
  assert.equal(await page.locator('.startup-consent').count(), 1, 'the packaged app should require the first-run connector notice before sign-in');
  const snapshot = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(snapshot.ok, 'packaged app should open its local database');
  assert.equal(snapshot.data.assets.length, 0, 'a new packaged app should start with an empty media library');
  assert.equal(snapshot.data.characters.length, 0, 'a new packaged app should not preload example characters');
  assert.ok(snapshot.data.capabilities.models.length === 0 || snapshot.data.capabilities.provider === 'google-flow', 'the installed app should use Google Flow, never bundled mock models');
  const terms = page.getByRole('dialog');
  await terms.getByRole('heading', { name: /Before you connect Google Flow|Bevor du Google Flow verbindest/ }).waitFor();
  assert.equal(await terms.getByRole('button', { name: /Continue to Google sign-in|Weiter zur Google-Anmeldung/ }).isDisabled(), true, 'the packaged app should require the notice checkbox');
  await terms.getByRole('checkbox').check();
  await terms.getByRole('button', { name: /Continue to Google sign-in|Weiter zur Google-Anmeldung/ }).click();
  const signIn = page.getByRole('dialog');
  await signIn.getByRole('heading', { name: /Connect your Google account|Google-Konto verbinden/ }).waitFor();
  assert.deepEqual(rendererErrors, [], `packaged renderer errors: ${rendererErrors.join('; ')}`);
  console.log('Packaged app smoke test passed: isolated empty library, Flow-only provider, and no development sample fixtures in app.asar.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(isolation, { recursive: true, force: true });
}
