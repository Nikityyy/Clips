import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import runtimeSpec from './flow-runtime-spec.json';

export type FlowJobKind = 'image' | 'video';

export interface FlowModel {
  id: string;
  label: string;
  kind: FlowJobKind;
  aliases: string[];
  referenceCap: number;
  maxDuration: number | null;
}

export interface FlowCatalog {
  models: FlowModel[];
  imageAspectRatios: string[];
  videoAspectRatios: string[];
}

export interface FlowProfile {
  name: string;
  google_account: string | null;
  is_default: boolean;
  cookies_present: boolean;
}

const OUTPUT_LIMIT = 4 * 1024 * 1024;
const DEFAULT_PROFILE = 'clips';
const GFLOW_VERSION = runtimeSpec.gflowVersion;
const UV_VERSION = runtimeSpec.uvVersion;
const FLOW_PYTHON = runtimeSpec.pythonVersion;
export const GOOGLE_LOGIN_ENTRY_URL = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fflow.google.com%2F';
const UV_RELEASES = 'https://releases.astral.sh/github/uv/releases/download';
export const UV_BUILDS = runtimeSpec.builds as Record<string, { archive: string; sha256: string; executable: string }>;

export async function patchGoogleLoginSources(cache: string): Promise<number> {
  const modules = ['internal_chromium.py', 'real_chrome.py'];
  let patched = 0;
  for (const entry of await fs.readdir(cache, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    for (const packagePath of [
      path.join(cache, entry.name, 'gflow_cli', 'auth'),
      path.join(cache, entry.name, 'Lib', 'site-packages', 'gflow_cli', 'auth'),
    ]) {
      for (const authModule of modules) {
        const file = path.join(packagePath, authModule);
        let source: string;
        try { source = await fs.readFile(file, 'utf8'); } catch { continue; }
        const updated = source.replace(/^GEMINI_URL = "https:\/\/labs\.google\/fx\/tools\/flow\?hl=en"\r?$/m, `GEMINI_URL = "${GOOGLE_LOGIN_ENTRY_URL}"`);
        if (updated !== source) {
          await fs.writeFile(file, updated);
          await fs.rm(path.join(packagePath, '__pycache__'), { recursive: true, force: true });
          patched += 1;
        } else if (source.includes(`GEMINI_URL = "${GOOGLE_LOGIN_ENTRY_URL}"`)) {
          patched += 1;
        }
      }
    }
  }
  if (patched < modules.length) throw new Error('The pinned gflow-cli login modules could not be updated to open Google sign-in directly.');
  return patched;
}

function parseRatioList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const ratio = (item as { ratio?: unknown }).ratio;
    return typeof ratio === 'string' && /^\d{1,3}:\d{1,3}$/.test(ratio) ? [ratio] : [];
  });
}

function parseModelList(value: unknown, kind: FlowJobKind): FlowModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const model = item as { name?: unknown; aliases?: unknown; ref_cap?: unknown; max_duration?: unknown };
    if (typeof model.name !== 'string' || !Array.isArray(model.aliases)) return [];
    const aliases = model.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.length > 0);
    if (!aliases.length) return [];
    return [{
      id: aliases[0],
      label: model.name,
      kind,
      aliases,
      referenceCap: typeof model.ref_cap === 'number' ? Math.max(0, model.ref_cap) : 0,
      maxDuration: typeof model.max_duration === 'number' ? model.max_duration : null,
    }];
  });
}

export function parseFlowCatalog(json: string): FlowCatalog {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') throw new Error('The gflow-cli model catalog was not valid JSON.');
  const root = parsed as { image?: unknown; video?: unknown };
  const image = root.image as { models?: unknown; aspects?: unknown } | undefined;
  const video = root.video as { models?: unknown; aspects?: unknown } | undefined;
  const models = [...parseModelList(image?.models, 'image'), ...parseModelList(video?.models, 'video')];
  if (!models.some((model) => model.kind === 'image') || !models.some((model) => model.kind === 'video')) {
    throw new Error('The installed gflow-cli did not provide image and video models. Update gflow-cli and try again.');
  }
  const imageAspectRatios = parseRatioList(image?.aspects);
  const videoAspectRatios = parseRatioList(video?.aspects);
  if (!imageAspectRatios.length || !videoAspectRatios.length) {
    throw new Error('The installed gflow-cli did not provide image and video aspect-ratio options. Update gflow-cli and try again.');
  }
  return { models, imageAspectRatios, videoAspectRatios };
}

export function parseFlowProfiles(json: string): FlowProfile[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('The gflow-cli account list was not valid JSON.');
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const profile = item as Partial<FlowProfile>;
    if (typeof profile.name !== 'string') return [];
    return [{
      name: profile.name,
      google_account: typeof profile.google_account === 'string' ? profile.google_account : null,
      is_default: profile.is_default === true,
      cookies_present: profile.cookies_present === true,
    }];
  });
}

export function parseGenerationPaths(json: string, kind: FlowJobKind): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') throw new Error('gflow-cli returned an invalid generation result.');
  const result = parsed as { status?: unknown; error_message?: unknown; failure_reasons?: unknown; error?: { detail?: unknown; title?: unknown }; images?: unknown; local_path?: unknown };
  if (result.status !== 'ok') {
    const failures = Array.isArray(result.failure_reasons) ? result.failure_reasons.filter((item): item is string => typeof item === 'string').join('; ') : '';
    const detail = typeof result.error_message === 'string' ? result.error_message : typeof result.error?.detail === 'string' ? result.error.detail : typeof result.error?.title === 'string' ? result.error.title : failures || 'Flow did not complete this generation.';
    throw new Error(detail.slice(0, 600));
  }
  if (kind === 'image' && Array.isArray(result.images)) {
    return result.images.flatMap((image) => {
      if (!image || typeof image !== 'object') return [];
      const localPath = (image as { local_path?: unknown }).local_path;
      return typeof localPath === 'string' && localPath ? [localPath] : [];
    });
  }
  return typeof result.local_path === 'string' && result.local_path ? [result.local_path] : [];
}

export class GFlowCli {
  readonly profileName = DEFAULT_PROFILE;
  private readonly userDataPath: () => string;
  private readonly bundledRuntimePath: (() => string | null) | null;
  private setupPromise: Promise<{ executable: string; env: NodeJS.ProcessEnv }> | null = null;
  private signInPreparationPromise: Promise<void> | null = null;

  constructor(userDataPath: () => string = () => path.join(os.homedir(), '.clips'), bundledRuntimePath: (() => string | null) | null = null) {
    this.userDataPath = userDataPath;
    this.bundledRuntimePath = bundledRuntimePath;
  }

  async prewarm(): Promise<void> {
    await this.prepareSignIn();
  }

  async catalog(): Promise<FlowCatalog> {
    const output = await this.run(['models', '--json'], 12 * 60_000);
    return parseFlowCatalog(output.stdout);
  }

  async profiles(): Promise<FlowProfile[]> {
    const output = await this.run(['auth', 'list', '--json'], 12 * 60_000);
    return parseFlowProfiles(output.stdout);
  }

  async login(profileName = DEFAULT_PROFILE): Promise<void> {
    await this.prepareSignIn();
    await this.run(['auth', 'login', '--profile', profileName, '--browser', 'auto'], 15 * 60_000);
  }

  async logout(profileName = DEFAULT_PROFILE): Promise<void> {
    await this.run(['auth', 'logout', '--profile', profileName, '--yes'], 90_000);
  }

  private async patchGoogleLoginEntryPoint(): Promise<void> {
    const cache = path.join(this.userDataPath(), 'runtime', 'uv', 'cache', 'archive-v0');
    await patchGoogleLoginSources(cache);
  }

  private async prepareSignIn(): Promise<void> {
    if (!this.signInPreparationPromise) {
      this.signInPreparationPromise = (async () => {
        const setup = await this.runtime();
        const readyMarker = path.join(this.userDataPath(), 'runtime', `signin-ready-${GFLOW_VERSION}.ready`);
        if (await fs.access(readyMarker).then(() => true, () => false)) return;
        await this.runCommand(setup.executable, ['tool', 'run', '--python', FLOW_PYTHON, '--from', `gflow-cli==${GFLOW_VERSION}`, 'gflow', '--help'], setup.env, 120_000);
        const browserMarker = path.join(setup.env.PLAYWRIGHT_BROWSERS_PATH ?? '', `clips-chromium-${GFLOW_VERSION}.ready`);
        const browserReady = await fs.access(browserMarker).then(() => true, () => false);
        if (!browserReady) {
          await this.runCommand(setup.executable, ['tool', 'run', '--python', FLOW_PYTHON, '--from', `gflow-cli==${GFLOW_VERSION}`, 'playwright', 'install', 'chromium', '--no-shell'], setup.env, 18 * 60_000);
          await fs.writeFile(browserMarker, GFLOW_VERSION, 'utf8');
        }
        await this.patchGoogleLoginEntryPoint();
        await fs.writeFile(readyMarker, GFLOW_VERSION, 'utf8');
      })().catch((error: unknown) => {
        this.signInPreparationPromise = null;
        throw error;
      });
    }
    await this.signInPreparationPromise;
  }

  async verifySession(profileName = DEFAULT_PROFILE): Promise<string> {
    const output = await this.run(['auth', 'status', '--profile', profileName], 90_000);
    // gflow-cli uses Rich, which may wrap status text in ANSI styles when piped.
    // oxlint-disable-next-line no-control-regex -- Strip terminal color sequences before parsing the stable status line.
    const clean = output.stdout.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
    const verified = clean.match(/Flow session verified(?: as ([^\r\n.]+))?/i);
    if (!verified) throw new Error('The Google session has not been verified by Flow yet.');
    return verified[1]?.trim() || '';
  }

  async generate(args: string[], timeoutMs = 30 * 60_000): Promise<string> {
    const output = await this.run(args, timeoutMs);
    return output.stdout;
  }

  private async run(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    const setup = await this.runtime();
    return this.runCommand(setup.executable, ['tool', 'run', '--python', FLOW_PYTHON, '--from', `gflow-cli==${GFLOW_VERSION}`, 'gflow', ...args], setup.env, timeoutMs);
  }

  private async runtime(): Promise<{ executable: string; env: NodeJS.ProcessEnv }> {
    if (!this.setupPromise) {
      this.setupPromise = this.prepareRuntime().catch((error: unknown) => {
        this.setupPromise = null;
        throw error;
      });
    }
    return this.setupPromise;
  }

  private async prepareRuntime(): Promise<{ executable: string; env: NodeJS.ProcessEnv }> {
    const root = path.join(this.userDataPath(), 'runtime');
    const target = path.join(root, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
    if (!process.env.UV_PATH && !await fs.access(target).then(() => true, () => false) && this.bundledRuntimePath) {
      const seed = this.bundledRuntimePath();
      if (seed) {
        await fs.cp(seed, root, { recursive: true, force: false, errorOnExist: false });
        await fs.rm(path.join(root, 'runtime-info.json'), { force: true });
      }
    }
    const existingUv = process.env.UV_PATH;
    const uvPath = existingUv || await this.ensureUv(root);
    const env = {
      ...process.env,
      GFLOW_CLI_PROFILE: this.profileName,
      GFLOW_CLI_HOME: path.join(root, 'gflow-home'),
      UV_TOOL_DIR: path.join(root, 'uv', 'tools'),
      UV_CACHE_DIR: path.join(root, 'uv', 'cache'),
      UV_PYTHON_INSTALL_DIR: path.join(root, 'uv', 'python'),
      UV_MANAGED_PYTHON: '1',
      UV_PYTHON_DOWNLOADS: 'automatic',
      PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'browsers'),
    };
    await Promise.all([env.GFLOW_CLI_HOME, env.UV_TOOL_DIR, env.UV_CACHE_DIR, env.UV_PYTHON_INSTALL_DIR, env.PLAYWRIGHT_BROWSERS_PATH].map((directory) => fs.mkdir(directory, { recursive: true })));
    return { executable: uvPath, env };
  }

  private async ensureUv(root: string): Promise<string> {
    const key = `${process.platform}-${process.arch}`;
    const build = UV_BUILDS[key];
    if (!build) throw new Error(`Google Flow sign-in is not supported on ${key}.`);
    const binDirectory = path.join(root, 'bin');
    const target = path.join(binDirectory, process.platform === 'win32' ? 'uv.exe' : 'uv');
    try { if ((await fs.stat(target)).isFile()) return target; } catch { /* first use */ }
    await fs.mkdir(binDirectory, { recursive: true });
    const temporary = await fs.mkdtemp(path.join(root, 'uv-setup-'));
    const archive = path.join(temporary, build.archive);
    const extracted = path.join(temporary, 'extracted');
    try {
      const response = await fetch(`${UV_RELEASES}/${UV_VERSION}/${build.archive}`, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Could not download the Clips Flow runtime (HTTP ${response.status}). Check your connection and try again.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 32 * 1024 * 1024) throw new Error('The Clips Flow runtime download was larger than expected.');
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== build.sha256) throw new Error('The Clips Flow runtime failed its integrity check. Please retry later.');
      await fs.writeFile(archive, bytes);
      await fs.mkdir(extracted, { recursive: true });
      await this.runCommand('tar', ['-xf', archive, '-C', extracted], process.env, 60_000);
      const source = path.join(extracted, build.executable);
      await fs.access(source);
      const staging = `${target}.new`;
      await fs.copyFile(source, staging);
      if (process.platform !== 'win32') await fs.chmod(staging, 0o755);
      await fs.rename(staging, target);
      return target;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runCommand(executable: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(executable, args, { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        reject(new Error(error instanceof Error ? error.message : 'Could not start gflow-cli.'));
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error('gflow-cli did not finish in time. Check its status before starting another generation.'), true);
      }, timeoutMs);
      const append = (current: string, chunk: Buffer, stream: string): string => {
        const next = current + chunk.toString('utf8');
        if (Buffer.byteLength(next, 'utf8') > OUTPUT_LIMIT) {
          child.kill();
          finish(new Error(`gflow-cli ${stream} output exceeded the safety limit.`), true);
          return current;
        }
        return next;
      };
      const finish = (error?: Error, fromTimer = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else if (!fromTimer) resolve({ stdout, stderr });
      };
      child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk, 'standard'); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk, 'diagnostic'); });
      child.once('error', (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        finish(new Error(code === 'ENOENT'
          ? 'The private Clips Flow runtime could not start. Check available disk space and your connection, then try again.'
          : `Could not start gflow-cli: ${error.message}`));
      });
      child.once('close', (code) => {
        if (settled) return;
        if (code === 0) finish();
        else {
          const message = `${stderr}\n${stdout}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-6).join(' ').slice(0, 600);
          finish(new Error(message || `gflow-cli exited with status ${code ?? 'unknown'}.`));
        }
      });
    });
  }
}
