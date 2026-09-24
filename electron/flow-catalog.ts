import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import runtimeSpec from './flow-runtime-spec.json';
import { friendlyModelName, readableModelFallback } from '../src/shared/model-label';

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

const OUTPUT_LIMIT = 4 * 1024 * 1024;
const GFLOW_VERSION = runtimeSpec.gflowVersion;
const UV_VERSION = runtimeSpec.uvVersion;
const FLOW_PYTHON = runtimeSpec.pythonVersion;
const UV_RELEASES = 'https://releases.astral.sh/github/uv/releases/download';
export const UV_BUILDS = runtimeSpec.builds as Record<string, { archive: string; sha256: string; executable: string }>;

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
    const model = item as { name?: unknown; display_name?: unknown; label?: unknown; aliases?: unknown; ref_cap?: unknown; max_duration?: unknown };
    if (typeof model.name !== 'string' || !Array.isArray(model.aliases)) return [];
    const aliases = model.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.length > 0);
    if (!aliases.length) return [];
    const friendlyAlias = aliases.map(friendlyModelName).find((label) => label !== null);
    const label = typeof model.display_name === 'string' && model.display_name.trim()
      ? model.display_name.trim()
      : typeof model.label === 'string' && model.label.trim()
        ? model.label.trim()
        : friendlyModelName(model.name) ?? friendlyAlias ?? readableModelFallback(aliases.find((alias) => alias.includes('-')) ?? model.name);
    return [{
      id: aliases[0],
      label,
      kind,
      aliases,
      referenceCap: typeof model.ref_cap === 'number' ? Math.max(0, model.ref_cap) : 0,
      maxDuration: typeof model.max_duration === 'number' ? model.max_duration : null,
    }];
  });
}

export function parseFlowCatalog(json: string): FlowCatalog {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') throw new Error('The Flow model catalog response was not valid JSON.');
  const root = parsed as { image?: unknown; video?: unknown };
  const image = root.image as { models?: unknown; aspects?: unknown } | undefined;
  const video = root.video as { models?: unknown; aspects?: unknown } | undefined;
  const models = [...parseModelList(image?.models, 'image'), ...parseModelList(video?.models, 'video')];
  if (!models.some((model) => model.kind === 'image') || !models.some((model) => model.kind === 'video')) {
    throw new Error('The live Flow catalog did not provide image and video models. Update gflow-cli and try again.');
  }
  const imageAspectRatios = parseRatioList(image?.aspects);
  const videoAspectRatios = parseRatioList(video?.aspects);
  if (!imageAspectRatios.length || !videoAspectRatios.length) {
    throw new Error('The live Flow catalog did not provide image and video aspect-ratio options. Update gflow-cli and try again.');
  }
  return { models, imageAspectRatios, videoAspectRatios };
}

/** Reads Google's current Flow models and options; never logs in or generates media. */
export class FlowCatalogClient {
  private readonly userDataPath: () => string;
  private readonly bundledRuntimePath: (() => string | null) | null;
  private setupPromise: Promise<{ executable: string; env: NodeJS.ProcessEnv }> | null = null;

  constructor(userDataPath: () => string = () => path.join(os.homedir(), '.clips'), bundledRuntimePath: (() => string | null) | null = null) {
    this.userDataPath = userDataPath;
    this.bundledRuntimePath = bundledRuntimePath;
  }

  async catalog(): Promise<FlowCatalog> {
    const output = await this.run(['models', '--json'], 12 * 60_000);
    return parseFlowCatalog(output.stdout);
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
    const uvPath = process.env.UV_PATH || await this.ensureUv(root);
    const env = {
      ...process.env,
      GFLOW_CLI_HOME: path.join(root, 'gflow-home'),
      UV_TOOL_DIR: path.join(root, 'uv', 'tools'),
      UV_TOOL_BIN_DIR: path.join(root, 'uv', 'bin'),
      UV_PYTHON_BIN_DIR: path.join(root, 'uv', 'bin'),
      UV_CACHE_DIR: path.join(root, 'uv', 'cache'),
      UV_PYTHON_INSTALL_DIR: path.join(root, 'uv', 'python'),
      UV_MANAGED_PYTHON: '1',
      UV_PYTHON_DOWNLOADS: 'automatic',
    };
    await Promise.all([env.GFLOW_CLI_HOME, env.UV_TOOL_DIR, env.UV_TOOL_BIN_DIR, env.UV_PYTHON_BIN_DIR, env.UV_CACHE_DIR, env.UV_PYTHON_INSTALL_DIR].map((directory) => fs.mkdir(directory, { recursive: true })));
    return { executable: uvPath, env };
  }

  private async ensureUv(root: string): Promise<string> {
    const key = `${process.platform}-${process.arch}`;
    const build = UV_BUILDS[key];
    if (!build) throw new Error(`The Flow catalog is not supported on ${key}.`);
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
        reject(new Error(error instanceof Error ? error.message : 'Could not start the Flow model catalog runtime.'));
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        child.kill();
        finish(new Error('The Flow model catalog did not finish loading in time.'), true);
      }, timeoutMs);
      const append = (current: string, chunk: Buffer, stream: string): string => {
        const next = current + chunk.toString('utf8');
        if (Buffer.byteLength(next, 'utf8') > OUTPUT_LIMIT) {
          child.kill();
          finish(new Error(`Flow model catalog ${stream} output exceeded the safety limit.`), true);
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
          : `Could not start the Flow model catalog tool: ${error.message}`));
      });
      child.once('close', (code) => {
        if (settled) return;
        if (code === 0) finish();
        else {
          const message = `${stderr}\n${stdout}`.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-6).join(' ').slice(0, 600);
          finish(new Error(message || `The Flow model catalog tool exited with status ${code ?? 'unknown'}.`));
        }
      });
    });
  }
}
