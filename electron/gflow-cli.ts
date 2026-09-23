import { spawn } from 'node:child_process';
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
  private readonly executable: string;

  constructor(executable = process.env.GFLOW_CLI_PATH || (process.platform === 'win32' ? 'gflow.exe' : 'gflow')) {
    this.executable = executable;
  }

  async catalog(): Promise<FlowCatalog> {
    const output = await this.run(['models', '--json'], 30_000);
    return parseFlowCatalog(output.stdout);
  }

  async profiles(): Promise<FlowProfile[]> {
    const output = await this.run(['auth', 'list', '--json'], 30_000);
    return parseFlowProfiles(output.stdout);
  }

  async login(): Promise<void> {
    await this.run(['auth', 'login', '--profile', this.profileName, '--browser', 'chrome'], 15 * 60_000);
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

  private run(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(this.executable, args, {
          env: { ...process.env, GFLOW_CLI_PROFILE: this.profileName },
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
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
          ? 'gflow-cli is not installed or is not on PATH. Install it with “uv tool install gflow-cli”, then install its browser with “uv tool run --from gflow-cli playwright install chromium”.'
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
