import assert from 'node:assert/strict';
import { copyFile, cp, mkdtemp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const userData = await mkdtemp(path.join(os.tmpdir(), 'clips-e2e-'));
const fixtureDirectory = path.join(userData, 'mock');
await cp(path.join(root, 'public', 'media', 'mock'), fixtureDirectory, { recursive: true });
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
      CLIPS_TEST_MEDIA_DIRECTORY: fixtureDirectory,
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

async function assertNoHorizontalOverflow(page) {
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(width.content <= width.viewport + 1, `horizontal overflow at ${width.viewport}px: ${width.content}px`);
}

async function waitForJob(page, prompt, matches, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastStatus = 'not found';
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(async () => window.clips.getSnapshot());
    if (snapshot.ok) {
      const job = snapshot.data.jobs.find((candidate) => candidate.prompt === prompt && matches(candidate));
      if (job) return job;
      lastStatus = snapshot.data.jobs.find((candidate) => candidate.prompt === prompt)?.status ?? 'not found';
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`Timed out waiting for “${prompt}”; last status was ${lastStatus}.`);
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
  assert.equal(await page.locator('.context-panel').count(), 0, 'the empty inspector should not take space until an asset is selected');
  const readNativeMenu = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => ({
    label: item.label,
    items: item.submenu?.items.map((child) => ({ id: child.id, label: child.label, accelerator: child.accelerator })) ?? [],
  })) ?? []);
  let nativeMenu = await readNativeMenu();
  assert.ok(nativeMenu.some((item) => item.label === 'File'));
  assert.ok(nativeMenu.find((item) => item.label === 'File')?.items.some((item) => item.id === 'clips-import-media' && item.accelerator));
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('clips-queue')?.click?.());
  await page.locator('.queue-workspace').waitFor();
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('clips-create')?.click?.());
  await page.getByRole('heading', { name: 'Creation studio' }).waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.result-card img')];
    return images.length === 6 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.getByRole('textbox', { name: 'Describe what you want to see' }).fill('A quiet figure at the edge of a sunlit room, fine grain.');
  await activate(page.getByRole('button', { name: 'Create 4 images' }));
  await page.waitForFunction(() => document.querySelectorAll('.result-grid .result-card').length === 4, { timeout: 15_000 });
  await waitForJob(page, 'A quiet figure at the edge of a sunlit room, fine grain.', (job) => job.status === 'completed');
  await activate(page.locator('.rail-nav-item[aria-label="Queue"]'));
  const imageJob = page.locator('.queue-job-card').filter({ hasText: 'A quiet figure' }).first();
  await activate(imageJob.getByRole('button', { name: 'Reuse settings' }));
  assert.equal(await page.getByRole('textbox', { name: 'Describe what you want to see' }).inputValue(), 'A quiet figure at the edge of a sunlit room, fine grain.');

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
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('clips-import-media')?.click?.());
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

  await activate(page.locator('.rail-nav-item[aria-label="Create"]'));
  await activate(page.locator('.result-card').first().getByRole('button', { name: 'Create a video' }));
  const videoPrompt = 'A slow turn toward the light, then a quiet smile.';
  await page.getByRole('textbox', { name: 'Describe what you want to see' }).fill(videoPrompt);
  const videoPath = path.join(fixtureDirectory, 'mock-video.mp4');
  const heldVideoPath = path.join(userData, 'mock-video-held.mp4');
  await rename(videoPath, heldVideoPath);
  await activate(page.getByRole('button', { name: 'Create video' }));
  await activate(page.locator('.rail-nav-item[aria-label="Queue"]'));
  const failedAttempt = await waitForJob(page, videoPrompt, (job) => job.status === 'failed');
  await rename(heldVideoPath, videoPath);
  const failedVideo = page.locator('.queue-job-card').filter({ hasText: videoPrompt }).first();
  await failedVideo.locator('.queue-status-pill.status-failed').waitFor({ state: 'visible', timeout: 5000 });
  assert.equal(failedAttempt.status, 'failed');
  await activate(failedVideo.getByRole('button', { name: 'Retry' }));
  await waitForJob(page, videoPrompt, (job) => job.status === 'completed' && Boolean(job.retryOfJobId));
  const videoJob = page.locator('.queue-job-card').filter({ hasText: videoPrompt }).first();
  await activate(videoJob.locator('.queue-output-item').first());
  await page.locator('.context-panel').waitFor();
  await page.waitForFunction(() => {
    const video = document.querySelector('.asset-inspector-preview video');
    return video instanceof HTMLVideoElement && video.controls && video.readyState >= 1 && video.duration > 0;
  }, { timeout: 15_000 });

  await activate(page.locator('.rail-nav-item[aria-label="Create"]'));
  await activate(page.getByRole('button', { name: 'Image', exact: true }));
  const cancelPrompt = 'Cancel this local sample safely.';
  await page.getByRole('textbox', { name: 'Describe what you want to see' }).fill(cancelPrompt);
  await activate(page.getByRole('button', { name: 'Create 4 images' }));
  await activate(page.locator('.rail-nav-item[aria-label="Queue"]'));
  const cancelJob = page.locator('.queue-job-card').filter({ hasText: cancelPrompt }).first();
  await activate(cancelJob.getByRole('button', { name: 'Cancel job' }));
  await waitForJob(page, cancelPrompt, (job) => job.status === 'cancelled');
  await page.setViewportSize({ width: 360, height: 760 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(root, 'test-results', 'queue-narrow.png'), fullPage: true });

  await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('clips-settings')?.click?.());
  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
  await page.waitForFunction(() => document.documentElement.lang === 'de');
  nativeMenu = await readNativeMenu();
  assert.ok(nativeMenu.some((item) => item.label === 'Datei'));
  assert.ok(nativeMenu.find((item) => item.label === 'Datei')?.items.some((item) => item.id === 'clips-import-media' && item.label === 'Medien importieren…'));
  await assertNoHorizontalOverflow(page);
  const accountsButton = page.locator('.toolbar-account[aria-label="Konten"]');
  await activate(accountsButton);
  await page.getByRole('textbox', { name: 'Browserprofil benennen' }).fill('E2E Flow profile');
  await page.getByRole('textbox', { name: 'Browserprofil benennen' }).press('Enter');
  const profile = page.locator('.account-row').filter({ hasText: 'E2E Flow profile' });
  await activate(profile.getByRole('button', { name: 'Aktiv setzen' }));
  await page.waitForFunction(() => document.querySelector('.toolbar-account')?.textContent?.includes('E2E Flow profile'));
  await assertNoHorizontalOverflow(page);
  const flowAccountId = await page.evaluate(async () => {
    const snapshot = await window.clips.getSnapshot();
    return snapshot.ok ? snapshot.data.accounts.find((account) => account.label === 'E2E Flow profile')?.id : null;
  });
  assert.ok(flowAccountId);
  const storageSummary = await page.evaluate(async () => window.clips.getStorageSummary());
  assert.ok(storageSummary.ok, 'local storage details should be available');
  assert.equal(path.resolve(storageSummary.data.directory), path.resolve(userData));
  assert.ok(storageSummary.data.mediaFiles >= 8, 'storage summary should count saved media');
  assert.ok(storageSummary.data.mediaBytes > 0 && storageSummary.data.databaseBytes > 0);

  await app.evaluate(({ shell }) => {
    shell.openPath = async (directory) => { globalThis.clipsOpenedDirectory = directory; return ''; };
    shell.openExternal = async (url) => { globalThis.clipsOpenedFlowUrl = url; return true; };
  });
  await activate(page.locator('.rail-footer .icon-button[aria-label="Einstellungen"]'));
  await page.getByTestId('storage-directory').getByText(userData, { exact: true }).waitFor();
  await activate(page.getByRole('button', { name: 'Datenordner öffnen' }));
  const openedDirectory = await app.evaluate(() => globalThis.clipsOpenedDirectory);
  assert.equal(path.resolve(openedDirectory), path.resolve(userData));

  await activate(page.locator('.toolbar-account[aria-label="Konten"]'));
  await activate(page.locator('.flow-connection-section').getByRole('button', { name: 'Flow öffnen' }));
  assert.equal(await app.evaluate(() => globalThis.clipsOpenedFlowUrl), 'https://labs.google/fx/tools/flow');
  const flowPath = path.join(userData, 'flow-export.png');
  await copyFile(path.join(root, 'public', 'media', 'mock', 'mara-02.png'), flowPath);
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, flowPath);
  await activate(page.locator('.rail-nav-item[aria-label="Mediathek"]'));
  await activate(page.getByRole('button', { name: 'Flow-Downloads importieren' }));
  await page.getByRole('button', { name: 'flow-export', exact: false }).waitFor();
  const flowAsset = await page.evaluate(async () => {
    const snapshot = await window.clips.getSnapshot();
    return snapshot.ok ? snapshot.data.assets.find((asset) => asset.fileName === 'flow-export.png') : null;
  });
  assert.ok(flowAsset, 'the downloaded Flow file should be copied into Clips');
  assert.equal(flowAsset.provenance.source, 'flow-handoff');
  assert.equal(flowAsset.provenance.provider, 'google-flow');
  assert.equal(flowAsset.provenance.accountId, flowAccountId);
  await page.setViewportSize({ width: 360, height: 760 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(root, 'test-results', 'library-flow-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1520, height: 959 });

  assert.deepEqual(rendererErrors, [], `renderer errors: ${rendererErrors.join('; ')}`);
  const expectedWindowBounds = await app.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = {
      x: area.x + 40,
      y: area.y + 40,
      width: Math.max(880, Math.min(1180, area.width - 80)),
      height: Math.max(640, Math.min(760, area.height - 80)),
    };
    BrowserWindow.getAllWindows()[0].setBounds(bounds);
    return bounds;
  });
  await page.waitForTimeout(350);
  await app.close();
  const savedWindowState = JSON.parse(await readFile(path.join(userData, 'window-state.json'), 'utf8'));
  for (const key of ['x', 'y', 'width', 'height']) assert.equal(savedWindowState[key], expectedWindowBounds[key]);
  assert.equal(savedWindowState.maximized, false);
  app = await launchApp();
  page = await app.firstWindow();
  monitorRenderer(page);
  await page.getByRole('heading', { name: 'Kreativstudio' }).waitFor();
  const restoredWindowBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  for (const key of ['x', 'y', 'width', 'height']) assert.equal(restoredWindowBounds[key], expectedWindowBounds[key]);
  assert.equal(await page.locator('html').getAttribute('lang'), 'de');
  assert.equal(await page.locator('.toolbar-account').textContent(), 'E2E Flow profile');
  assert.equal(await page.getByRole('dialog').count(), 0, 'onboarding should stay dismissed after restart');
  const restartSnapshot = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(restartSnapshot.ok);
  assert.ok(restartSnapshot.data.characters.some((character) => character.name === 'Luma'));
  assert.ok(restartSnapshot.data.jobs.some((job) => job.status === 'completed' && job.prompt.startsWith('A quiet figure')));
  assert.ok(restartSnapshot.data.jobs.some((job) => job.status === 'completed' && job.prompt === 'A slow turn toward the light, then a quiet smile.' && job.retryOfJobId));
  assert.ok(restartSnapshot.data.jobs.some((job) => job.status === 'cancelled' && job.prompt === 'Cancel this local sample safely.'));
  console.log('Electron end-to-end flow passed: native menu actions, window restoration, creation, retry, cancellation, video playback, characters, import, storage, Flow handoff, search, assignment, localization, accounts, and restart persistence.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
