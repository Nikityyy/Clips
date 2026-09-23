import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

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
const GFLOW_VERSION = '0.79.1';
const UV_VERSION = '0.12.18';
const UV_RELEASES = 'https://releases.astral.sh/github/uv/releases/download';
export const UV_BUILDS: Record<string, { archive: string; sha256: string; executable: string }> = {
  'win32-x64': { archive: 'uv-x86_64-pc-windows-msvc.zip', sha256: 'cae6a3bc25239f83dffb467a4b180508d9da23986c04639ebfa44e43e6a84bff', executable: 'uv.exe' },
  'darwin-x64': { archive: 'uv-x86_64-apple-darwin.tar.gz', sha256: '2e4108f5395397c8bc5d43bf83d3bdbb2d0e92b90d0efa607756be704905fa33', executable: 'uv-x86_64-apple-darwin/uv' },
  'darwin-arm64': { archive: 'uv-aarch64-apple-darwin.tar.gz', sha256: 'cf40e0c6a202190ccd9e0406dcfdd5b2d6668a9a5c779b17948963df32aafe5b', executable: 'uv-aarch64-apple-darwin/uv' },
  'linux-x64': { archive: 'uv-x86_64-unknown-linux-gnu.tar.gz', sha256: '89eadd7c76fc063887959510d5ba0ab1264dfd5f1143b925ddb73021a40acf16', executable: 'uv-x86_64-unknown-linux-gnu/uv' },
  'linux-arm64': { archive: 'uv-aarch64-unknown-linux-gnu.tar.gz', sha256: 'afb6291f3f0a6b4521fc67b947822506c41dde5b60d2189dd8f3695b2ac8c9e7', executable: 'uv-aarch64-unknown-linux-gnu/uv' },
};

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
  private setupPromise: Promise<{ executable: string; env: NodeJS.ProcessEnv }> | null = null;

  constructor(userDataPath: () => string = () => path.join(os.homedir(), '.clips')) {
    this.userDataPath = userDataPath;
  }

  async catalog(): Promise<FlowCatalog> {
    const output = await this.run(['models', '--json'], 12 * 60_000);
    return parseFlowCatalog(output.stdout);
  }

  async profiles(): Promise<FlowProfile[]> {
    const output = await this.run(['auth', 'list', '--json'], 12 * 60_000);
    return parseFlowProfiles(output.stdout);
  }

  async login(): Promise<void> {
    await this.setupBrowser();
    await this.run(['auth', 'login', '--profile', this.profileName, '--browser', 'auto'], 15 * 60_000);
  }

  private async setupBrowser(): Promise<void> {
    const setup = await this.runtime();
    await this.runCommand(setup.executable, ['tool', 'run', '--from', `gflow-cli==${GFLOW_VERSION}`, 'playwright', 'install', 'chromium'], setup.env, 18 * 60_000);
  }

  async verifySession(): Promise<string> {
    const output = await this.run(['auth', 'status', '--profile', this.profileName], 90_000);
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
    return this.runCommand(setup.executable, ['tool', 'run', '--from', `gflow-cli==${GFLOW_VERSION}`, 'gflow', ...args], setup.env, timeoutMs);
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
    const existingUv = process.env.UV_PATH;
    const uvPath = existingUv || await this.ensureUv(root);
    const env = {
      ...process.env,
      GFLOW_CLI_PROFILE: this.profileName,
      GFLOW_CLI_HOME: path.join(root, 'gflow-home'),
      UV_TOOL_DIR: path.join(root, 'uv', 'tools'),
      UV_CACHE_DIR: path.join(root, 'uv', 'cache'),
      UV_PYTHON_INSTALL_DIR: path.join(root, 'uv', 'python'),
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
