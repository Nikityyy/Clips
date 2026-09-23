param(
  [Parameter(Mandatory = $true)][string]$Seed,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$metadata = Get-Content -Raw (Join-Path $Seed 'runtime-info.json') | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -Path (Join-Path $Seed '*') -Destination $Destination -Recurse -Force
$env:GFLOW_CLI_HOME = Join-Path $Destination 'gflow-home'
$env:UV_TOOL_DIR = Join-Path $Destination 'uv\tools'
$env:UV_CACHE_DIR = Join-Path $Destination 'uv\cache'
$env:UV_PYTHON_INSTALL_DIR = Join-Path $Destination 'uv\python'
$env:UV_MANAGED_PYTHON = '1'
$env:UV_PYTHON_DOWNLOADS = 'automatic'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $Destination 'browsers'
$env:UV_OFFLINE = '1'
$uv = Join-Path $Destination 'bin\uv.exe'
function Invoke-Uv([string[]]$Arguments, [string]$FailureMessage) {
  $ErrorActionPreference = 'Continue'
  & $uv @Arguments 2>&1 | Out-Null
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($exitCode -ne 0) { throw "$FailureMessage (exit $exitCode)." }
}
Invoke-Uv @('tool', 'run', '--python', $metadata.pythonVersion, '--from', "gflow-cli==$($metadata.gflowVersion)", 'gflow', '--help') 'Could not prepare gflow-cli from the installer cache'
Invoke-Uv @('tool', 'run', '--python', $metadata.pythonVersion, '--from', "gflow-cli==$($metadata.gflowVersion)", 'playwright', 'install', 'chromium', '--no-shell') 'Could not prepare Chromium from the installer cache'
Remove-Item (Join-Path $Destination 'runtime-info.json') -Force -ErrorAction SilentlyContinue
Write-Output 'The private Clips Flow runtime is ready.'
