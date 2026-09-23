param(
  [Parameter(Mandatory = $true)][string]$SpecPath,
  [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$metadata = Get-Content -Raw $SpecPath | ConvertFrom-Json
$build = $metadata.builds | Select-Object -ExpandProperty 'win32-x64'
if (-not $build) { throw 'Clips has no verified Flow runtime for this Windows architecture.' }
$metadataPath = Join-Path $Destination 'runtime-info.json'
$uv = Join-Path $Destination 'bin\uv.exe'
$pythonDirectory = Join-Path $Destination 'uv\python'
$browserDirectory = Join-Path $Destination 'browsers'
$marker = Join-Path $Destination '.clips-flow-runtime.json'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$ready = $false
try {
  $installed = Get-Content -Raw $marker | ConvertFrom-Json
  $ready = $installed.gflowVersion -eq $metadata.gflowVersion -and $installed.pythonVersion -eq $metadata.pythonVersion -and (Test-Path $uv) -and (Test-Path $pythonDirectory) -and (Get-ChildItem $browserDirectory -Directory -Filter 'chromium-*' -ErrorAction SilentlyContinue | Select-Object -First 1)
} catch { $ready = $false }
if ($ready) {
  Write-Output 'The private Clips Flow runtime is already ready.'
  exit 0
}

$temporary = Join-Path $env:TEMP ('clips-runtime-setup-' + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $temporary $build.archive
try {
  New-Item -ItemType Directory -Force -Path $temporary | Out-Null
  if (-not (Test-Path $uv)) {
    Write-Output 'Downloading verified uv runtime...'
    New-Item -ItemType Directory -Force -Path $temporary, (Split-Path $uv) | Out-Null
    Invoke-WebRequest -Uri "https://releases.astral.sh/github/uv/releases/download/$($metadata.uvVersion)/$($build.archive)" -OutFile $archive -UseBasicParsing
    $actualHash = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $build.sha256) { throw 'The downloaded uv runtime failed its SHA-256 integrity check.' }
    $extract = Join-Path $temporary 'extracted'
    Expand-Archive -Path $archive -DestinationPath $extract -Force
    $source = Join-Path $extract $build.executable
    if (-not (Test-Path $source)) { throw 'The verified uv archive did not contain the expected executable.' }
    Copy-Item -Path $source -Destination $uv -Force
  }

  $env:GFLOW_CLI_HOME = Join-Path $Destination 'gflow-home'
  $env:UV_TOOL_DIR = Join-Path $Destination 'uv\tools'
  $env:UV_CACHE_DIR = Join-Path $Destination 'uv\cache'
  $env:UV_PYTHON_INSTALL_DIR = $pythonDirectory
  $env:UV_MANAGED_PYTHON = '1'
  $env:UV_PYTHON_DOWNLOADS = 'automatic'
  $env:PLAYWRIGHT_BROWSERS_PATH = $browserDirectory
  $env:UV_OFFLINE = '0'
  foreach ($directory in @($env:GFLOW_CLI_HOME, $env:UV_TOOL_DIR, $env:UV_CACHE_DIR, $pythonDirectory, $browserDirectory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  function Invoke-Uv([string[]]$Arguments, [string]$FailureMessage) {
    $stdout = Join-Path $temporary 'uv-stdout.log'
    $stderr = Join-Path $temporary 'uv-stderr.log'
    $process = Start-Process -FilePath $uv -ArgumentList $Arguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if ($process.ExitCode -ne 0) {
      $detail = Get-Content -Path $stderr, $stdout -Tail 30 -ErrorAction SilentlyContinue | Out-String
      throw "$FailureMessage (exit $($process.ExitCode)). $detail"
    }
  }
  Write-Output "Preparing managed Python $($metadata.pythonVersion)..."
  Invoke-Uv @('python', 'install', $metadata.pythonVersion) 'Could not install managed Python'
  Write-Output "Preparing gflow-cli $($metadata.gflowVersion)..."
  Invoke-Uv @('tool', 'run', '--python', $metadata.pythonVersion, '--from', "gflow-cli==$($metadata.gflowVersion)", 'gflow', '--help') 'Could not install gflow-cli'
  Write-Output 'Preparing the private Chromium sign-in browser...'
  Invoke-Uv @('tool', 'run', '--python', $metadata.pythonVersion, '--from', "gflow-cli==$($metadata.gflowVersion)", 'playwright', 'install', 'chromium', '--no-shell') 'Could not install the sign-in browser'
  Remove-Item $metadataPath -Force -ErrorAction SilentlyContinue
  @{ gflowVersion = $metadata.gflowVersion; pythonVersion = $metadata.pythonVersion } | ConvertTo-Json | Set-Content -Encoding UTF8 $marker
  Write-Output 'The private Clips Flow runtime is ready.'
} catch {
  Remove-Item $marker -Force -ErrorAction SilentlyContinue
  throw
} finally {
  Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
