import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const userData = await mkdtemp(path.join(os.tmpdir(), 'clips-e2e-'));
const screenshotPath = path.join(root, 'test-results', 'foundation-desktop.png');
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

let app;
try {
  app = await launchApp();
  let page = await app.firstWindow();
  page.on('pageerror', (error) => console.error('[renderer pageerror]', error.message));
  page.on('console', (message) => { if (message.type() === 'error') console.error('[renderer console]', message.text()); });
  const actualUserData = await app.evaluate(({ app }) => app.getPath('userData'));
  console.log(`Isolated Electron data: ${actualUserData}`);
  await page.waitForTimeout(800);
  console.log(`Initial renderer: ${await page.locator('body').innerText()}`);
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.title(), 'Clips');
  await page.getByRole('dialog').getByRole('button', { name: 'Skip setup' }).click();
  await page.getByRole('heading', { name: 'Creation studio' }).waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.sample-plate-item img')];
    return images.length === 6 && images.every((image) => image.complete && image.naturalWidth > 0);
  });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Captured ${screenshotPath}`);

  await page.keyboard.press('Control+,');
  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
  await page.waitForFunction(() => document.documentElement.lang === 'de');

  const accountsButton = page.getByRole('button', { name: 'Konten' }).first();
  await accountsButton.focus();
  await accountsButton.press('Enter');
  await page.getByRole('textbox', { name: 'Browserprofil benennen' }).fill('E2E Flow profile');
  await page.getByRole('textbox', { name: 'Browserprofil benennen' }).press('Enter');
  const profile = page.locator('.account-row').filter({ hasText: 'E2E Flow profile' });
  const activateButton = profile.getByRole('button', { name: 'Aktiv setzen' });
  await activateButton.focus();
  await activateButton.press('Enter');
  await page.waitForFunction(() => document.querySelector('.toolbar-account')?.textContent?.includes('E2E Flow profile'));

  await app.close();
  app = await launchApp();
  page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Kreativstudio' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('lang'), 'de');
  assert.equal(await page.locator('.toolbar-account').textContent(), 'E2E Flow profile');
  assert.equal(await page.getByRole('dialog').count(), 0, 'onboarding should stay dismissed after restart');
  console.log('Electron foundation flow passed: onboarding, local samples, German preference, account label, and restart persistence.');
} finally {
  if (app) await app.close().catch(() => undefined);
  await rm(userData, { recursive: true, force: true });
}
