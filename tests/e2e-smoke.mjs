import assert from 'node:assert/strict';
import { copyFile, cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const userData = await mkdtemp(path.join(os.tmpdir(), 'clips-e2e-'));
const fixtureDirectory = path.join(userData, 'mock');
await cp(path.join(root, 'fixtures', 'dev-media'), fixtureDirectory, { recursive: true });
const screenshotDirectory = path.join(root, 'test-results');
const rendererErrors = [];
await mkdir(screenshotDirectory, { recursive: true });

async function launchApp(forceOnboarding = false) {
  return electron.launch({
    args: [path.join(root, 'out-electron', 'electron', 'main.js')],
    cwd: root,
    locale: 'en-US',
    timeout: 45_000,
    env: {
      ...process.env,
      CLIPS_TEST_PROVIDER: 'mock',
      CLIPS_TEST_USER_DATA: userData,
      CLIPS_TEST_MEDIA_DIRECTORY: fixtureDirectory,
      CLIPS_RENDERER_URL: 'http://localhost:3000',
      CLIPS_FORCE_ONBOARDING: forceOnboarding ? '1' : '',
    },
  });
}

function monitorRenderer(page) {
  page.on('pageerror', (error) => rendererErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') rendererErrors.push(message.text()); });
}

async function assertNoHorizontalOverflow(page) {
  const size = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(size.content <= size.viewport + 1, `horizontal overflow at ${size.viewport}px: ${size.content}px`);
}

async function waitForJob(page, prompt, predicate, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastStatus = 'not found';
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(async () => window.clips.getSnapshot());
    if (snapshot.ok) {
      const job = snapshot.data.jobs.find((candidate) => candidate.prompt === prompt);
      if (job && predicate(job)) return job;
      lastStatus = job?.status ?? 'not found';
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`Timed out waiting for “${prompt}”; last status was ${lastStatus}.`);
}

let app;
try {
  app = await launchApp();
  const page = await app.firstWindow();
  monitorRenderer(page);
  await page.getByRole('dialog').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('500 14px "Manrope Variable"')), true, 'the app should load the bundled Manrope variable font');
  assert.equal(await page.locator('.onboarding-visual').count(), 1, 'the first-run introduction should open with its animated visual preview');
  assert.equal(await page.title(), 'Clips');
  const onboardingChrome = await page.evaluate(() => ({
    windows: document.documentElement.classList.contains('is-windows'),
    dragDisplay: getComputedStyle(document.querySelector('.window-drag-region')).display,
    dragRegion: getComputedStyle(document.querySelector('.window-drag-region')).webkitAppRegion,
    focusedElement: document.activeElement?.tagName,
    focusOutline: getComputedStyle(document.activeElement).outlineStyle,
    backdrop: getComputedStyle(document.querySelector('dialog'), '::backdrop').backgroundColor,
    pageBackground: getComputedStyle(document.body).backgroundColor,
  }));
  if (onboardingChrome.windows) {
    assert.equal(onboardingChrome.dragDisplay, 'block', 'the Windows onboarding title strip should be visible');
    assert.equal(onboardingChrome.dragRegion, 'drag', 'the Windows onboarding title strip should move the app window');
  }
  assert.equal(onboardingChrome.focusedElement, 'DIALOG', 'opening onboarding should not autofocus a button and show a white ring');
  assert.equal(onboardingChrome.focusOutline, 'none', 'the onboarding dialog itself should not draw a focus border');
  assert.equal(onboardingChrome.backdrop, 'rgba(0, 0, 0, 0)', 'onboarding should not darken the canvas beneath the Windows title controls');

  const onboarding = page.getByRole('dialog');
  const language = onboarding.getByRole('button', { name: 'Language' });
  await language.click();
  const languageMenu = page.getByRole('listbox', { name: 'Language' });
  assert.equal(await languageMenu.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(32, 32, 31)', 'the language menu should use the app’s dark palette');
  await languageMenu.getByRole('option', { name: 'English' }).click();
  const introBounds = [];
  introBounds.push(await onboarding.locator('.modal-panel').boundingBox());
  for (let step = 0; step < 3; step += 1) {
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    introBounds.push(await onboarding.locator('.modal-panel').boundingBox());
  }
  for (const bounds of introBounds.slice(1)) {
    assert.ok(Math.abs(bounds.width - introBounds[0].width) <= 1, 'onboarding width should stay fixed between steps');
    assert.ok(Math.abs(bounds.height - introBounds[0].height) <= 1, 'onboarding height should stay fixed between steps');
  }
  await onboarding.getByRole('button', { name: 'Open the studio' }).click();
  const terms = page.getByRole('dialog');
  await terms.getByRole('heading', { name: 'Before you connect Google Flow' }).waitFor();
  assert.equal(await terms.getByRole('button', { name: 'Continue to Google sign-in' }).isDisabled(), true, 'the required notice must be acknowledged before proceeding');
  await page.keyboard.press('Escape');
  assert.equal(await terms.isVisible(), true, 'the required terms gate cannot be dismissed');
  const prematureConnect = await page.evaluate(() => window.clips.connectFlow());
  assert.equal(prematureConnect.ok, false, 'Flow IPC must reject sign-in before notice acceptance');
  assert.equal(prematureConnect.error.code, 'PERMISSION_DENIED');
  const consentSpacing = await terms.evaluate((dialog) => {
    const consent = dialog.querySelector('.startup-consent').getBoundingClientRect();
    const note = dialog.querySelector('.startup-legal-limit').getBoundingClientRect();
    return note.top - consent.bottom;
  });
  assert.ok(consentSpacing >= 12, `the legal note should breathe below the consent border (gap: ${consentSpacing}px)`);
  await terms.getByRole('checkbox').check();
  await terms.getByRole('button', { name: 'Continue to Google sign-in' }).click();
  const signIn = page.getByRole('dialog');
  await signIn.getByRole('heading', { name: 'Connect your Google account' }).waitFor();
  await signIn.getByRole('button', { name: 'Continue with local test mode' }).click();
  const tutorial = page.getByRole('dialog');
  await tutorial.getByRole('heading', { name: /Make images and clips/ }).waitFor();
  for (let step = 0; step < 4; step += 1) {
    const next = tutorial.getByRole('button', { name: step === 3 ? 'Open the studio' : 'Continue' });
    await next.click();
  }
  await page.getByRole('heading', { name: 'Creation studio' }).waitFor();
  await page.evaluate(() => document.documentElement.classList.add('is-windows'));
  const titlebarLayout = await page.evaluate(() => ({
    shellTopPadding: getComputedStyle(document.querySelector('.app-shell')).paddingTop,
    navigationTop: document.querySelector('.navigation-rail').getBoundingClientRect().top,
    toolbarBackground: getComputedStyle(document.querySelector('.workspace-toolbar')).backgroundColor,
    railBackground: getComputedStyle(document.querySelector('.navigation-rail')).backgroundColor,
    shellBackground: getComputedStyle(document.querySelector('.app-shell')).backgroundColor,
    reservedControlSpace: Number.parseFloat(getComputedStyle(document.querySelector('.workspace-toolbar')).paddingRight),
  }));
  assert.equal(titlebarLayout.shellTopPadding, '0px', 'Windows app content should integrate into the caption row without a blank spacer');
  assert.equal(titlebarLayout.navigationTop, 0, 'the navigation rail should begin at the top of the window');
  assert.equal(titlebarLayout.toolbarBackground, titlebarLayout.shellBackground, 'the app toolbar should match the Windows caption-control background');
  assert.equal(titlebarLayout.railBackground, titlebarLayout.shellBackground, 'the app rail should match the Windows caption-control background');
  assert.ok(titlebarLayout.reservedControlSpace >= 150, 'toolbar actions should stay clear of native caption buttons');
  await page.evaluate(() => document.documentElement.classList.remove('is-windows'));
  assert.equal(await page.locator('.composer-panel > .composer-field').first().locator('.field-label').textContent(), 'Character', 'character choice should be the first generation setting');
  assert.equal(await page.locator('.workspace-route').evaluate((element) => getComputedStyle(element).animationName), 'workspace-arrive', 'page changes should use a restrained entrance animation');
  assert.equal(await page.locator('.brand-mark svg.lucide-clapperboard').count(), 1, 'the navigation should use Lucide’s Clapperboard icon');
  assert.equal(await page.locator('.brand-mark svg.lucide-clapperboard').getAttribute('stroke-width'), '2.4', 'the app mark should stay legible at navigation size');

  const initial = await page.evaluate(async () => window.clips.getSnapshot());
  assert.ok(initial.ok);
  assert.equal(initial.data.assets.length, 0, 'new test profiles should not be preloaded with example media');
  assert.equal(initial.data.characters.length, 0, 'new test profiles should not be preloaded with characters');
  assert.equal(initial.data.capabilities.provider, 'mock');
  assert.equal(await page.getByRole('button', { name: /Flow downloads/i }).count(), 0, 'generation results should stay in Clips instead of exposing a manual Flow handoff');
  const flowConnect = await page.evaluate(() => window.clips.connectFlow());
  assert.equal(flowConnect.ok, false, 'the Flow connect IPC should be registered even when the local test provider is active');
  assert.equal(flowConnect.error.code, 'PROVIDER_UNAVAILABLE', 'the local test provider should report that Flow login is intentionally disabled');
  assert.equal(await page.locator('.rail-nav-item').count(), 4);
  assert.equal(await page.locator('.rail-nav-item[aria-label="Images"], .rail-nav-item[aria-label="Videos"]').count(), 0, 'images and videos should live under the single Library destination');
  assert.equal(await page.locator('.rail-nav-item[aria-label="Library"]').getAttribute('title'), null, 'the navigation should use custom tooltips instead of native browser tooltips');
  assert.ok(await page.locator('.rail-nav-item[aria-label="Library"]').getAttribute('data-tooltip'));
  const libraryButton = page.locator('.rail-nav-item[aria-label="Library"]');
  await libraryButton.hover();
  const tooltip = page.locator('#clips-tooltip');
  await tooltip.waitFor({ state: 'visible' });
  const tooltipBounds = await tooltip.boundingBox();
  const viewportBounds = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(tooltipBounds && tooltipBounds.x >= 0 && tooltipBounds.y >= 0 && tooltipBounds.x + tooltipBounds.width <= viewportBounds.width && tooltipBounds.y + tooltipBounds.height <= viewportBounds.height, 'custom tooltips should remain fully within the app window');
  await libraryButton.click();
  await tooltip.waitFor({ state: 'hidden' });
  await page.locator('.rail-nav-item').nth(0).click();
  assert.equal(await page.locator('.context-panel').count(), 0, 'the empty inspector should not take space until an asset is selected');
  const nativeMenu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((item) => item.label) ?? []);
  if (process.platform === 'win32') assert.deepEqual(nativeMenu, [], 'Windows should use the clean title bar without a File/Edit/View menu');

  await page.getByRole('textbox', { name: 'Describe what you want to see' }).fill('A quiet figure at the edge of a sunlit room, fine grain.');
  const modelPicker = page.locator('.generation-options .menu-select').first();
  await modelPicker.getByRole('button').click();
  await page.getByRole('listbox', { name: 'Model' }).getByRole('option', { name: 'Portrait study' }).click();
  await page.getByRole('button', { name: 'Create 4 images' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.result-grid .result-card').length === 4, { timeout: 15_000 });
  await waitForJob(page, 'A quiet figure at the edge of a sunlit room, fine grain.', (job) => job.status === 'completed');
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.result-grid .result-card img')];
    return images.length === 4 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  assert.equal(await page.locator('.generation-options .ratio-options button').count(), initial.data.capabilities.imageAspectRatios.length, 'all provider-supported image aspects should be shown');
  await page.screenshot({ path: path.join(screenshotDirectory, 'clips-creation-studio.png'), fullPage: true });

  const firstAsset = await page.evaluate(async () => {
    const snapshot = await window.clips.getSnapshot();
    return snapshot.ok ? snapshot.data.assets.find((asset) => asset.kind === 'image') : null;
  });
  assert.ok(firstAsset);
  await page.locator('.result-card-open').first().click();
  assert.equal(await page.locator('.context-work-panel').evaluate((element) => getComputedStyle(element).animationName), 'inspector-arrive', 'opening image details should ease into view');
  await page.evaluate(() => document.documentElement.classList.add('is-windows'));
  assert.equal(await page.locator('.context-panel-heading').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(17, 17, 16)', 'the caption row should stay visually continuous above image details');
  await page.evaluate(() => document.documentElement.classList.remove('is-windows'));
  await page.locator('.result-card-open').first().click();
  const characterResult = await page.evaluate(async (portraitAssetId) => window.clips.createCharacter({
    name: 'Luma',
    description: 'A recurring fictional subject.',
    prompt: 'Short dark curls, attentive expression, soft window light.',
    portraitAssetId,
    referenceAssetIds: [portraitAssetId],
  }), firstAsset.id);
  assert.ok(characterResult.ok, 'a character can use a library portrait');
  assert.equal(characterResult.data.portraitAssetId, firstAsset.id, 'the selected portrait should be saved on the character');
  await page.locator('.composer-panel .menu-select').first().getByRole('button').click();
  const characterOption = page.getByRole('listbox', { name: 'Character' }).getByRole('option', { name: /Luma/ });
  try {
    await characterOption.locator('img').waitFor({ timeout: 2500 });
  } catch {
    const previewState = await page.evaluate(async () => {
      const snapshot = await window.clips.getSnapshot();
      return snapshot.ok ? { characters: snapshot.data.characters.map(({ name, portraitAssetId }) => ({ name, portraitAssetId })), assets: snapshot.data.assets.map(({ id, uri }) => ({ id, uri })), option: document.querySelector('.menu-select-options')?.innerHTML } : snapshot;
    });
    throw new Error(`Character dropdown portrait preview missing: ${JSON.stringify(previewState)}`);
  }
  assert.equal(await characterOption.locator('img').count(), 1, 'character choices should show their portrait');
  await characterOption.click();

  await page.getByRole('button', { name: 'Video', exact: true }).click();
  await page.getByText('Reference images', { exact: true }).waitFor();
  await page.locator('.composer-panel .menu-select').first().getByRole('button').click();
  await page.getByRole('listbox', { name: 'Character' }).getByRole('option', { name: /Luma/ }).click();
  await page.getByRole('textbox', { name: 'Describe what you want to see' }).fill('A slow turn toward the light, then a quiet smile.');
  await page.getByRole('button', { name: 'Create video' }).click();
  await waitForJob(page, 'A slow turn toward the light, then a quiet smile.', (job) => job.status === 'completed');
  const videoJob = await page.evaluate(async () => {
    const snapshot = await window.clips.getSnapshot();
    return snapshot.ok ? snapshot.data.jobs.find((job) => job.kind === 'video') : null;
  });
  assert.ok(videoJob);
  assert.equal(videoJob.inputAssetIds.length, 1, 'the selected character portrait should be sent as a video reference');

  await page.locator('.rail-nav-item[aria-label="Library"]').click();
  await page.getByRole('heading', { name: 'Library', level: 1 }).waitFor();
  assert.equal(await page.locator('.library-kind-tabs button').count(), 3, 'the single library should offer in-place media filters');
  const importPath = path.join(userData, 'e2e-reference.png');
  await copyFile(path.join(root, 'fixtures', 'dev-media', 'mara-01.png'), importPath);
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, importPath);
  await page.getByRole('button', { name: 'Import media' }).click();
  await page.getByRole('button', { name: /Inspect asset: e2e-reference/ }).waitFor();
  const importedState = await page.evaluate(async () => { const snapshot = await window.clips.getSnapshot(); return snapshot.ok ? snapshot.data.assets.filter((asset) => asset.title.includes('e2e-reference')).map(({ title, kind, deletedAt }) => ({ title, kind, deletedAt })) : snapshot; });
  assert.ok(importedState.some((asset) => asset.kind === 'image' && !asset.deletedAt), `the imported reference should be active in the library: ${JSON.stringify(importedState)}`);
  await page.locator('.rail-nav-item[aria-label="Create"]').click();
  await page.getByRole('button', { name: 'Choose from library' }).click();
  const picker = page.locator('.asset-picker-modal');
  await page.getByRole('heading', { name: 'Choose video reference images' }).waitFor();
  assert.ok((await picker.boundingBox()).height < 620, 'a short library should keep the reference picker compact');
  const chooseButton = page.locator('.reference-actions .picker-select-button');
  assert.equal(await chooseButton.evaluate((element) => getComputedStyle(element).justifyContent), 'center', 'the library picker action label should be centered');
  await page.screenshot({ path: path.join(screenshotDirectory, 'clips-reference-picker-open.png') });
  const pickerTile = picker.locator('.picker-item').filter({ hasText: 'e2e-reference' });
  if (await pickerTile.count() === 0) {
    const pickerState = await page.evaluate(() => ({ items: document.querySelectorAll('.picker-item').length, body: document.querySelector('.asset-picker-modal')?.innerText, imageOptions: [...document.querySelectorAll('.picker-item')].map((item) => item.innerText) }));
    throw new Error(`Library picker did not show its imported image: ${JSON.stringify({ importedState, pickerState })}`);
  }
  await pickerTile.click();
  assert.equal(await pickerTile.getAttribute('aria-pressed'), 'true');
  await picker.getByRole('button', { name: 'Done' }).click();
  await page.getByText('e2e-reference', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(screenshotDirectory, 'clips-reference-picker.png'), fullPage: true });

  await page.locator('.rail-footer .icon-button[aria-label="Settings"]').click();
  const settingsLanguage = page.getByRole('button', { name: 'Language' });
  await settingsLanguage.click();
  await page.getByRole('listbox', { name: 'Language' }).getByRole('option', { name: 'Deutsch' }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'de');
  await assertNoHorizontalOverflow(page);
  await page.setViewportSize({ width: 360, height: 760 });
  await assertNoHorizontalOverflow(page);
  await page.screenshot({ path: path.join(screenshotDirectory, 'clips-settings-narrow.png'), fullPage: true });
  await page.setViewportSize({ width: 1520, height: 959 });

  if (await page.locator('.toast').count()) await page.locator('.toast button').last().click();

  const pageRoutes = [
    ['create', () => page.locator('.rail-nav-item').nth(0).click()],
    ['characters', () => page.locator('.rail-nav-item').nth(1).click()],
    ['library', () => page.locator('.rail-nav-item').nth(2).click()],
    ['queue', () => page.locator('.rail-nav-item').nth(3).click()],
    ['accounts', () => page.locator('.toolbar-account').click()],
    ['settings', () => page.locator('.rail-footer .icon-button').click()],
  ];
  const monitorSizes = [
    { width: 360, height: 760 },
    { width: 600, height: 800 },
    { width: 860, height: 900 },
    { width: 1160, height: 900 },
    { width: 1360, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
  ];
  for (const size of monitorSizes) {
    await page.setViewportSize(size);
    for (const [route, open] of pageRoutes) {
      await open();
      const layout = await page.evaluate(() => {
        const workspace = document.querySelector('.workspace-content');
        const heading = document.querySelector('.workspace-toolbar-title h1');
        const unnamedButtons = [...document.querySelectorAll('button')].filter((element) => element.getClientRects().length && !element.getAttribute('aria-label') && !element.innerText.trim() && !element.getAttribute('title'));
        const undersizedText = [...document.querySelectorAll('body *')].filter((element) => element.children.length === 0 && element.innerText?.trim() && element.getClientRects().length && Number.parseFloat(getComputedStyle(element).fontSize) < 10.5).map((element) => ({ text: element.innerText.trim().slice(0, 45), size: getComputedStyle(element).fontSize }));
        return {
          heading: heading?.textContent?.trim(),
          viewportWidth: document.documentElement.clientWidth,
          documentWidth: document.documentElement.scrollWidth,
          workspaceWidth: workspace?.clientWidth,
          workspaceContentWidth: workspace?.scrollWidth,
          unnamedButtons: unnamedButtons.map((element) => element.outerHTML.slice(0, 140)),
          undersizedText,
          quietTextContrast: (() => {
            const colors = ['--quiet', '--surface'].map((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim());
            const luminances = colors.map((value) => {
              const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset + 1, offset + 3), 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
              return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
            });
            return (Math.max(...luminances) + .05) / (Math.min(...luminances) + .05);
          })(),
        };
      });
      assert.ok(layout.heading, `${route} should expose a page heading at ${size.width}px`);
      assert.ok(layout.documentWidth <= layout.viewportWidth + 1, `${route} document overflows at ${size.width}px: ${JSON.stringify(layout)}`);
      assert.ok((layout.workspaceContentWidth ?? 0) <= (layout.workspaceWidth ?? 0) + 2, `${route} content overflows horizontally at ${size.width}px: ${JSON.stringify(layout)}`);
      assert.deepEqual(layout.unnamedButtons, [], `${route} has buttons without accessible names at ${size.width}px: ${JSON.stringify(layout.unnamedButtons)}`);
      assert.deepEqual(layout.undersizedText, [], `${route} has text below 10.5px at ${size.width}px: ${JSON.stringify(layout.undersizedText)}`);
      assert.ok(layout.quietTextContrast >= 4.5, `${route} muted text contrast is below WCAG AA at ${size.width}px: ${layout.quietTextContrast}`);
      if (route === 'create' && size.width === 360) {
        await page.locator('.reference-actions .picker-select-button').click();
        const mobilePicker = page.locator('.asset-picker-modal');
        const pickerBounds = await mobilePicker.boundingBox();
        assert.ok(pickerBounds && pickerBounds.x >= 0 && pickerBounds.y >= 0 && pickerBounds.x + pickerBounds.width <= size.width && pickerBounds.y + pickerBounds.height <= size.height, `the reference picker should fit on a 360px screen: ${JSON.stringify(pickerBounds)}`);
        await mobilePicker.locator('.picker-confirm-button').click();
      }
      const rail = page.locator('.navigation-rail');
      const railBefore = await rail.boundingBox();
      await page.locator('.workspace-content').evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const railAfter = await rail.boundingBox();
      assert.ok(railBefore && railAfter && Math.abs(railAfter.y - railBefore.y) < 1, `${route} navigation rail should stay anchored while page content scrolls at ${size.width}px`);
      await page.locator('.workspace-content').evaluate((element) => { element.scrollTop = 0; });
      if ([360, 860, 1360, 2560].includes(size.width)) {
        await page.screenshot({ path: path.join(screenshotDirectory, `layout-${route}-${size.width}.png`) });
      }
    }
  }
  await page.setViewportSize({ width: 1520, height: 959 });

  assert.deepEqual(rendererErrors, [], `packaged renderer errors: ${rendererErrors.join('; ')}`);
  const expectedWindowBounds = await app.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = {
      x: area.x + 40,
      y: area.y + 40,
      width: Math.max(880, Math.min(1440, area.width - 80)),
      height: Math.max(640, Math.min(960, area.height - 80)),
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
  const restoredPage = await app.firstWindow();
  monitorRenderer(restoredPage);
  await restoredPage.getByRole('heading', { name: 'Kreativstudio' }).waitFor();
  const restoredBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  for (const key of ['x', 'y', 'width', 'height']) assert.equal(restoredBounds[key], expectedWindowBounds[key]);
  assert.equal(await restoredPage.locator('html').getAttribute('lang'), 'de');
  const finalSnapshot = await restoredPage.evaluate(async () => window.clips.getSnapshot());
  assert.ok(finalSnapshot.ok);
  assert.ok(finalSnapshot.data.characters.some((character) => character.name === 'Luma'));
  assert.ok(finalSnapshot.data.jobs.some((job) => job.status === 'completed' && job.prompt.startsWith('A quiet figure')));
  assert.ok(finalSnapshot.data.jobs.some((job) => job.status === 'completed' && job.kind === 'video' && job.inputAssetIds.length === 1));
  assert.deepEqual(rendererErrors, [], `renderer errors: ${rendererErrors.join('; ')}`);
  await app.close();
  app = await launchApp(true);
  const replayPage = await app.firstWindow();
  monitorRenderer(replayPage);
  await replayPage.getByRole('heading', { name: /Bilder und Clips|Make images and clips/ }).waitFor();
  assert.equal(await replayPage.locator('.onboarding-visual').count(), 1, 'CLIPS_FORCE_ONBOARDING should replay the welcome introduction even after completion');
  assert.deepEqual(rendererErrors, [], `renderer errors after replay: ${rendererErrors.join('; ')}`);
  console.log('Desktop e2e smoke test passed: onboarding replay and window chrome, first-run setup, local generations, reference selection, localization, accessibility basics, fixed navigation, and all six pages across seven viewport widths.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
