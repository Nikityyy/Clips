import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const specPath = path.join(projectRoot, 'electron', 'flow-runtime-spec.json');
const spec = JSON.parse(await fs.readFile(specPath, 'utf8'));
const platformKey = `${process.platform}-${process.arch}`;
const build = spec.builds[platformKey];
if (!build) throw new Error(`No bundled Flow runtime is available for ${platformKey}.`);
const seedRoot = path.join(projectRoot, 'build', 'flow-runtime-seed');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'clips-flow-runtime-'));

function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: projectRoot, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} exited with ${code ?? 'unknown status'}.`)));
  });
}

try {
  await fs.mkdir(seedRoot, { recursive: true });
  await Promise.all(['bin', 'uv/tools', 'uv/python', 'gflow-home'].map((directory) => fs.rm(path.join(seedRoot, directory), { recursive: true, force: true })));
  await fs.rm(path.join(seedRoot, 'runtime-info.json'), { force: true });
  const directories = [
    'bin', 'uv/tools', 'uv/cache', 'uv/python', 'browsers', 'gflow-home',
  ];
  await Promise.all(directories.map((directory) => fs.mkdir(path.join(seedRoot, directory), { recursive: true })));
  const response = await fetch(`https://releases.astral.sh/github/uv/releases/download/${spec.uvVersion}/${build.archive}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Could not fetch uv (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== build.sha256) throw new Error('The downloaded uv archive failed its SHA-256 integrity check.');
  const archivePath = path.join(scratch, build.archive);
  const extracted = path.join(scratch, 'extracted');
  await fs.mkdir(extracted, { recursive: true });
  await fs.writeFile(archivePath, bytes);
  await run('tar', ['-xf', archivePath, '-C', extracted], process.env);
  const uvSource = path.join(extracted, build.executable);
  await fs.access(uvSource);
  const uvPath = path.join(seedRoot, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
  await fs.copyFile(uvSource, uvPath);
  if (process.platform !== 'win32') await fs.chmod(uvPath, 0o755);
  const runtimeEnv = {
    ...process.env,
    GFLOW_CLI_HOME: path.join(seedRoot, 'gflow-home'),
    UV_TOOL_DIR: path.join(seedRoot, 'uv', 'tools'),
    UV_CACHE_DIR: path.join(seedRoot, 'uv', 'cache'),
    UV_PYTHON_INSTALL_DIR: path.join(seedRoot, 'uv', 'python'),
    UV_MANAGED_PYTHON: '1',
    UV_PYTHON_DOWNLOADS: 'automatic',
    PLAYWRIGHT_BROWSERS_PATH: path.join(seedRoot, 'browsers'),
  };
  console.log(`Preparing pinned gflow-cli ${spec.gflowVersion}, managed Python ${spec.pythonVersion}, and Chromium for ${platformKey}…`);
  await run(uvPath, ['python', 'install', spec.pythonVersion], runtimeEnv);
  await run(uvPath, ['tool', 'run', '--python', spec.pythonVersion, '--from', `gflow-cli==${spec.gflowVersion}`, 'gflow', '--help'], runtimeEnv);
  await run(uvPath, ['tool', 'run', '--python', spec.pythonVersion, '--from', `gflow-cli==${spec.gflowVersion}`, 'playwright', 'install', 'chromium', '--no-shell'], runtimeEnv);
  await fs.writeFile(path.join(seedRoot, 'runtime-info.json'), JSON.stringify({ gflowVersion: spec.gflowVersion, pythonVersion: spec.pythonVersion }));
  const archiveCache = path.join(seedRoot, 'uv', 'cache', 'archive-v0');
  for (const entry of await fs.readdir(archiveCache, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const cachedVenv = path.join(archiveCache, entry.name);
    try { await fs.access(path.join(cachedVenv, 'pyvenv.cfg')); await fs.rm(cachedVenv, { recursive: true, force: true }); } catch { /* package archive, not a movable tool environment */ }
  }
  for (const entry of await fs.readdir(path.join(seedRoot, 'browsers'))) {
    if (entry.startsWith('chromium_headless_shell-')) await fs.rm(path.join(seedRoot, 'browsers', entry), { recursive: true, force: true });
  }
  console.log(`Prepared installer runtime seed at ${seedRoot}.`);
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
