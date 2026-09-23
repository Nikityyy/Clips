import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const userData = await mkdtemp(path.join(os.tmpdir(), 'clips-e2e-'));
const screenshotPath = path.join(root, 'test-results', 'foundation-desktop.png');
const rendererErrors = [];
await mkdir(path.dirname(screenshotPath), { recursive: true });

async function launchApp() {
  return electron.launch({
    args: [path.join(root, 'out-electron', 'electron', 'main.js')],
    cwd: root,
    locale: 'en-US',
    timeout: 45_000,
    env: {
      ...process.env,
      CLIPS_TEST_USER_DATA: userData,
      CLIPS_RENDERER_URL: 'http://localhost:3000',
    },
  });
}

function monitorRenderer(page) {
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') rendererErrors.push(message.text()); });
}

async function activate(locator) {
  await locator.focus();
  await locator.press('Enter');
}

let app;
try {
  app = await launchApp();
  let page = await app.firstWindow();
  monitorRenderer(page);
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.title(), 'Clips');
  await page.getByRole('dialog').getByRole('button', { name: 'Skip setup' }).click();
  await page.getByRole('heading', { name: 'Creation studio' }).waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.result-card img')];
    return images.length === 6 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.getByRole('textbox', { name: 'Describe what you want to see' }).fill('A quiet figure at the edge of a sunlit room, fine grain.');
  await activate(page.getByRole('button', { name: 'Create 4 images' }));
  await page.waitForFunction(() => document.querySelectorAll('.result-grid .result-card').length === 4, { timeout: 15_000 });
  await page.waitForFunction(async () => {
    const snapshot = await window.clips.getSnapshot();
    return snapshot.ok && snapshot.data.jobs.some((job) => job.status === 'completed' && job.prompt.startsWith('A quiet figure'));
  }, { timeout: 15_000 });

  await activate(page.locator('.rail-nav-item[aria-label="Characters"]'));
  await activate(page.getByRole('button', { name: 'New character' }));
  await page.getByRole('textbox', { name: 'Name' }).fill('Luma');
  await page.getByRole('textbox', { name: 'Description' }).fill('A recurring fictional subject for local studies.');
  await page.getByRole('textbox', { name: 'Character prompt' }).fill('Short dark curls, attentive expression, soft window light.');
  await activate(page.getByRole('button', { name: 'Save character' }));
  await page.getByRole('heading', { name: 'Luma' }).waitFor();

  await activate(page.locator('.rail-nav-item[aria-label="Library"]'));
  const fixturePath = path.join(userData, 'e2e-reference.png');
  await copyFile(path.join(root, 'public', 'media', 'mock', 'mara-01.png'), fixturePath);
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, fixturePath);
  await activate(page.getByRole('button', { name: 'Import media' }));
  await page.getByRole('button', { name: 'e2e-reference', exact: false }).waitFor();
  await page.getByRole('textbox', { name: 'Search' }).fill('e2e-reference');
  await page.waitForFunction(() => document.querySelectorAll('.library-card').length === 1);
  await activate(page.getByRole('button', { name: 'Select' }));
  await activate(page.getByRole('button', { name: 'Select: e2e-reference' }));
  const imported = await page.evaluate(async () => {
    const snapshot = await window.clips.getSnapshot();
    return snapshot.ok ? snapshot.data.assets.find((asset) => asset.fileName === 'e2e-reference.png' && asset.provenance.source === 'import') : null;
  });
  assert.ok(imported, 'the fixture should be copied into the local library');
  const snapshotBeforeAssign = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(snapshotBeforeAssign.ok);
  const lumaId = snapshotBeforeAssign.data.characters.find((character) => character.name === 'Luma')?.id;
  assert.ok(lumaId);
  await page.getByRole('combobox', { name: 'Add to a character' }).selectOption(lumaId);
  const snapshotAfterAssign = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(snapshotAfterAssign.ok);
  assert.ok(snapshotAfterAssign.data.assets.find((asset) => asset.id === imported.id)?.provenance.characterIds.includes(lumaId));
  await activate(page.getByRole('button', { name: 'Inspect asset: e2e-reference' }));
  await page.getByRole('dialog', { name: 'Asset details' }).getByText('Imported', { exact: true }).waitFor();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+,');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
  await page.waitForFunction(() => document.documentElement.lang === 'de');
  const accountsButton = page.getByRole('button', { name: 'Konten' }).first();
  await activate(accountsButton);
  await page.getByRole('textbox', { name: 'Browserprofil benennen' }).fill('E2E Flow profile');
  await page.getByRole('textbox', { name: 'Browserprofil benennen' }).press('Enter');
  const profile = page.locator('.account-row').filter({ hasText: 'E2E Flow profile' });
  await activate(profile.getByRole('button', { name: 'Aktiv setzen' }));
  await page.waitForFunction(() => document.querySelector('.toolbar-account')?.textContent?.includes('E2E Flow profile'));

  assert.deepEqual(rendererErrors, [], `renderer errors: ${rendererErrors.join('; ')}`);
  await app.close();
  app = await launchApp();
  page = await app.firstWindow();
  monitorRenderer(page);
  await page.getByRole('heading', { name: 'Kreativstudio' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'de');
  assert.equal(await page.locator('.toolbar-account').textContent(), 'E2E Flow profile');
  assert.equal(await page.getByRole('dialog').count(), 0, 'onboarding should stay dismissed after restart');
  const restartSnapshot = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(restartSnapshot.ok);
  assert.ok(restartSnapshot.data.characters.some((character) => character.name === 'Luma'));
  assert.ok(restartSnapshot.data.jobs.some((job) => job.status === 'completed' && job.prompt.startsWith('A quiet figure')));
  console.log('Electron end-to-end flow passed: samples, generation, characters, import, search, assignment, localization, accounts, and restart persistence.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
