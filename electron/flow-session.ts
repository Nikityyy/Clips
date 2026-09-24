import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

export const FLOW_HOME_URL = 'https://flow.google.com/';
export const FLOW_LOGIN_URL = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fflow.google.com%2F';

export class FlowSessionError extends Error {
  constructor(readonly code: 'CHROME_NOT_FOUND' | 'CHROME_START_FAILED' | 'SESSION_NOT_READY' | 'SESSION_CLOSED' | 'SIGN_IN_CANCELLED', message: string) {
    super(message);
    this.name = 'FlowSessionError';
  }
}

interface ManagedSession {
  profileName: string;
  profileDirectory: string;
  port: number;
  process: ChildProcess;
  browser: Browser;
  page: Page;
  closed: boolean;
}

function isFlowPage(url: string): boolean {
  try { return new URL(url).hostname === 'flow.google.com'; } catch { return false; }
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

export async function findChromeExecutable(platform = process.platform, env = process.env): Promise<string | null> {
  const candidates = platform === 'win32'
    ? [
      path.join(env.PROGRAMFILES ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]
    : platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const candidate of candidates) if (await fileExists(candidate)) return candidate;
  return null;
}

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local browser port.');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForCdp(port: number, child: ChildProcess, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new FlowSessionError('CHROME_START_FAILED', 'Chrome closed before Clips could connect.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new FlowSessionError('CHROME_START_FAILED', lastError instanceof Error ? `Clips could not connect to Chrome: ${lastError.message}` : 'Chrome did not start its local connection in time.');
}

function safeProfileName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48);
  if (!safe) throw new TypeError('Invalid Google Flow account profile.');
  return safe;
}

/** Owns a single signed-in Flow tab per account in an isolated Chrome profile. */
export class FlowSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly loginProcesses = new Map<string, ChildProcess>();

  constructor(private readonly dataDirectory: string | (() => string), private readonly chromeExecutable?: string) {}

  profileDirectory(profileName: string): string {
    const root = typeof this.dataDirectory === 'function' ? this.dataDirectory() : this.dataDirectory;
    return path.join(root, 'runtime', 'gflow-home', `profile_${safeProfileName(profileName)}`);
  }

  async connect(profileName: string): Promise<{ page: Page; profileDirectory: string }> {
    const existing = this.sessions.get(profileName);
    if (existing && !existing.closed && !existing.page.isClosed()) {
      if (!isFlowPage(existing.page.url())) await existing.page.goto(FLOW_HOME_URL, { waitUntil: 'domcontentloaded' });
      return { page: existing.page, profileDirectory: existing.profileDirectory };
    }

    const executable = this.chromeExecutable ?? await findChromeExecutable();
    if (!executable) throw new FlowSessionError('CHROME_NOT_FOUND', 'Install Google Chrome to connect Clips to Google Flow.');
    const profileDirectory = this.profileDirectory(profileName);
    await fs.mkdir(profileDirectory, { recursive: true });
    const port = await availablePort();
    const child = spawn(executable, [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--start-minimized',
      '--new-window',
      FLOW_HOME_URL,
    ], { stdio: 'ignore', windowsHide: false, detached: process.platform !== 'win32' });
    child.once('error', () => undefined);

    try {
      await waitForCdp(port, child);
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10_000 });
      const context = browser.contexts()[0];
      if (!context) throw new FlowSessionError('CHROME_START_FAILED', 'Chrome opened without a browser context.');
      let page = context.pages().find((candidate) => isFlowPage(candidate.url()));
      if (!page) page = await context.newPage();
      if (!isFlowPage(page.url())) await page.goto(FLOW_HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      try {
        await page.waitForFunction(() => {
          const bodyText = document.body?.innerText?.trim() ?? '';
          const wiz = (window as typeof window & { WIZ_global_data?: Record<string, unknown> }).WIZ_global_data ?? {};
          const signedIn = typeof wiz.SNlM0e === 'string' && Boolean(wiz.SNlM0e);
          if (!signedIn) return bodyText.length > 60;
          const projectLinks = document.querySelectorAll('a[href*="/project/"]').length > 0;
          const projectAction = [...document.querySelectorAll('button,[role=button]')].some((element) => /new project|start creating/i.test(element.textContent ?? ''));
          return projectLinks || projectAction;
        }, undefined, { timeout: 25_000 });
      } catch {
        throw new FlowSessionError('SESSION_NOT_READY', 'Google Flow did not finish loading. Check your connection and reconnect.');
      }
      const session: ManagedSession = { profileName, profileDirectory, port, process: child, browser, page, closed: false };
      this.sessions.set(profileName, session);
      child.once('exit', () => { session.closed = true; this.sessions.delete(profileName); });
      browser.on('disconnected', () => { session.closed = true; this.sessions.delete(profileName); });
      page.on('close', () => { session.closed = true; this.sessions.delete(profileName); });
      return { page, profileDirectory };
    } catch (error) {
      this.terminate(child);
      if (error instanceof FlowSessionError) throw error;
      const message = error instanceof Error ? error.message : 'Chrome could not be started.';
      throw new FlowSessionError('CHROME_START_FAILED', message);
    }
  }

  async login(profileName: string): Promise<{ page: Page; profileDirectory: string }> {
    await this.close(profileName);
    const executable = this.chromeExecutable ?? await findChromeExecutable();
    if (!executable) throw new FlowSessionError('CHROME_NOT_FOUND', 'Install Google Chrome to connect Clips to Google Flow.');
    const profileDirectory = this.profileDirectory(profileName);
    await fs.mkdir(profileDirectory, { recursive: true });
    const child = spawn(executable, [
      `--user-data-dir=${profileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      '--new-window',
      FLOW_LOGIN_URL,
    ], { stdio: 'ignore', windowsHide: false, detached: process.platform !== 'win32' });
    child.once('error', () => undefined);
    this.loginProcesses.set(profileName, child);
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new FlowSessionError('SESSION_NOT_READY', 'Sign-in is taking too long. Close the Chrome window and try again.')), 15 * 60_000);
        child.once('error', (error) => { clearTimeout(timeout); reject(new FlowSessionError('CHROME_START_FAILED', error.message)); });
        child.once('exit', () => { clearTimeout(timeout); resolve(); });
      });
    } finally {
      this.loginProcesses.delete(profileName);
    }
    const connected = await this.connect(profileName);
    if (!await this.isAuthenticated(profileName)) {
      throw new FlowSessionError('SIGN_IN_CANCELLED', 'Flow did not confirm the sign-in. Connect again and finish Google sign-in before closing Chrome.');
    }
    return connected;
  }

  async page(profileName: string): Promise<Page> {
    const session = this.sessions.get(profileName);
    if (!session || session.closed || session.page.isClosed()) throw new FlowSessionError('SESSION_CLOSED', 'The Google Flow browser session is not open.');
    return session.page;
  }

  async accountEmail(profileName: string): Promise<string> {
    const session = this.sessions.get(profileName);
    if (!session || session.closed || session.page.isClosed()) return '';
    try {
      return await session.page.evaluate(() => {
        const candidates = [...document.querySelectorAll<HTMLElement>('button,[role=button],a,[aria-label],[title]')].slice(0, 300);
        for (const element of candidates) {
          const text = `${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('title') ?? ''} ${element.innerText ?? ''}`;
          const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
          if (email) return email;
        }
        return '';
      });
    } catch { return ''; }
  }

  async isAuthenticated(profileName: string, timeoutMs = 8_000): Promise<boolean> {
    const session = this.sessions.get(profileName);
    if (!session || session.closed || session.page.isClosed()) return false;
    try {
      await session.page.waitForFunction(
        () => Boolean((window as typeof window & { WIZ_global_data?: Record<string, unknown> }).WIZ_global_data?.SNlM0e),
        undefined,
        { timeout: timeoutMs },
      );
      return true;
    } catch { return false; }
  }

  async logout(profileName: string): Promise<void> {
    const session = this.sessions.get(profileName);
    if (session && !session.closed) {
      await session.page.context().clearCookies();
      await session.page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => undefined);
      await session.page.goto('https://accounts.google.com/Logout', { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      this.terminate(session.process);
      session.closed = true;
      this.sessions.delete(profileName);
    }
    await fs.rm(this.profileDirectory(profileName), { recursive: true, force: true });
  }

  async close(profileName?: string): Promise<void> {
    for (const [name, child] of this.loginProcesses) {
      if (!profileName || name === profileName) { this.terminate(child); this.loginProcesses.delete(name); }
    }
    const targets = profileName ? [this.sessions.get(profileName)].filter((entry): entry is ManagedSession => Boolean(entry)) : [...this.sessions.values()];
    for (const session of targets) {
      if (session.closed) continue;
      session.closed = true;
      this.sessions.delete(session.profileName);
      await session.browser.close().catch(() => undefined);
      this.terminate(session.process);
    }
  }

  private terminate(child: ChildProcess): void {
    if (child.exitCode !== null || child.killed) return;
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
      killer.unref();
    } else if (child.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    } else child.kill('SIGTERM');
  }
}
