param(
  [string]$Strategy = "",
  [switch]$SkipPlugin,
  [switch]$DryRun
)

# Docker-only update for PowerShell users.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
Set-Location $RootDir

$EnvPath = Join-Path $RootDir ".env"

function Write-MemSenseLog {
  param([string]$Message)
  Write-Host "[memsense] $Message"
}

function Fail {
  param([string]$Message)
  Write-Host "[memsense] $Message" -ForegroundColor Red
  exit 1
}

function Invoke-Step {
  param(
    [string]$FilePath,
    [string[]]$Arguments = @()
  )
  $display = (@($FilePath) + $Arguments) -join " "
  if ($DryRun) {
    Write-MemSenseLog "(dry-run) $display"
    return
  }

  Write-MemSenseLog "running: $display"
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "command failed: $display"
  }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [string]$Label,
    [int]$TimeoutSeconds = 600
  )
  Write-MemSenseLog "waiting for $Label at $Url"
  if ($DryRun) {
    Write-MemSenseLog "(dry-run) wait for $Label"
    return
  }

  for ($i = 1; $i -le $TimeoutSeconds; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        Write-MemSenseLog "$Label healthy"
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  Fail "$Label did not become healthy within ${TimeoutSeconds}s"
}

function Read-EnvValue {
  param([string]$Key)
  if (-not (Test-Path -LiteralPath $EnvPath)) {
    return ""
  }

  foreach ($line in [System.IO.File]::ReadAllLines($EnvPath)) {
    if ($line -match "^\s*$([Regex]::Escape($Key))=(.*)$") {
      return $Matches[1]
    }
  }
  return ""
}

function Resolve-PowerShellCommand {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }

  $powershell = Get-Command powershell -ErrorAction SilentlyContinue
  if ($powershell) {
    return $powershell.Source
  }

  Fail "PowerShell executable not found on PATH"
}

function Detect-Strategy {
  if (-not [string]::IsNullOrWhiteSpace($Strategy)) {
    return $Strategy
  }

  $provider = Read-EnvValue "MEMSENSE_EMBEDDING_PROVIDER"
  if ($provider -eq "openai") {
    return "openai"
  }
  if ($provider -eq "bge_http" -or [string]::IsNullOrWhiteSpace($provider)) {
    return "local"
  }
  Fail "cannot infer embedding mode from MEMSENSE_EMBEDDING_PROVIDER=$provider; pass local or openai"
}

function Test-HostTagWorkerAvailable {
  $provider = Read-EnvValue "MEMSENSE_TAGGER_PROVIDER"
  if ([string]::IsNullOrWhiteSpace($provider)) {
    $provider = "auto"
  }
  if ($provider -ne "auto" -and $provider -ne "openclaw" -and $provider -ne "openclaw_cli") {
    return $false
  }
  if ($DryRun) {
    return $true
  }
  return [bool](Get-Command openclaw -ErrorAction SilentlyContinue) -and [bool](Get-Command npm -ErrorAction SilentlyContinue)
}

function Ensure-NodeDeps {
  if ($DryRun) {
    return
  }
  if (-not (Test-Path -LiteralPath (Join-Path $RootDir "node_modules"))) {
    Invoke-Step "npm" @("ci")
  }
}

function Get-TagWorkerConcurrency {
  $raw = if ($env:MEMSENSE_TAG_WORKER_CONCURRENCY) {
    $env:MEMSENSE_TAG_WORKER_CONCURRENCY
  } else {
    Read-EnvValue "MEMSENSE_TAG_WORKER_CONCURRENCY"
  }
  $parsed = 0
  if (-not [int]::TryParse($raw, [ref]$parsed) -or $parsed -lt 1) {
    return 3
  }
  return $parsed
}

function Start-HostTagWorker {
  $pgHostPort = if ($env:MEMSENSE_POSTGRES_PORT) {
    $env:MEMSENSE_POSTGRES_PORT
  } else {
    Read-EnvValue "MEMSENSE_POSTGRES_PORT"
  }
  if ([string]::IsNullOrWhiteSpace($pgHostPort)) {
    $pgHostPort = "54329"
  }

  Write-MemSenseLog "using host tag-worker so tags can reuse OpenClaw's configured model"
  Invoke-Step "docker" @("compose", "stop", "tag-worker")
  Ensure-NodeDeps

  if ($DryRun) {
    Write-MemSenseLog "(dry-run) start host tag-worker"
    return
  }

  $runtimeDir = Join-Path $RootDir ".runtime"
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $pidPaths = @()
  $pidPaths += Join-Path $runtimeDir "tag-worker.pid"
  $pidPaths += @(Get-ChildItem -LiteralPath $runtimeDir -Filter "tag-worker-*.pid" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
  foreach ($pidPath in $pidPaths) {
    if (-not (Test-Path -LiteralPath $pidPath)) {
      continue
    }
    $oldPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
    if ($oldPid) {
      try {
        Stop-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
      } catch {}
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  }

  $concurrency = Get-TagWorkerConcurrency
  $taggerProvider = if ($env:MEMSENSE_TAGGER_PROVIDER) { $env:MEMSENSE_TAGGER_PROVIDER } else { Read-EnvValue "MEMSENSE_TAGGER_PROVIDER" }
  $taggerModel = if ($env:MEMSENSE_TAGGER_MODEL) { $env:MEMSENSE_TAGGER_MODEL } else { Read-EnvValue "MEMSENSE_TAGGER_MODEL" }
  $openClawCli = if ($env:MEMSENSE_OPENCLAW_CLI) { $env:MEMSENSE_OPENCLAW_CLI } else { Read-EnvValue "MEMSENSE_OPENCLAW_CLI" }

  $env:MEMSENSE_DATABASE_URL = "postgresql://memsense:memsense@127.0.0.1:$pgHostPort/memsense"
  $env:MEMSENSE_TAGGER_PROVIDER = if ([string]::IsNullOrWhiteSpace($taggerProvider)) { "auto" } else { $taggerProvider }
  $env:MEMSENSE_TAGGER_MODEL = if ([string]::IsNullOrWhiteSpace($taggerModel)) { "auto" } else { $taggerModel }
  $env:MEMSENSE_OPENCLAW_CLI = if ([string]::IsNullOrWhiteSpace($openClawCli)) { "openclaw" } else { $openClawCli }
  $env:MEMSENSE_TAG_WORKER_CONCURRENCY = "$concurrency"

  $npm = Get-Command npm -ErrorAction Stop
  for ($i = 1; $i -le $concurrency; $i++) {
    $name = if ($concurrency -eq 1) { "tag-worker" } else { "tag-worker-$i" }
    $pidPath = Join-Path $runtimeDir "$name.pid"
    $outLog = Join-Path $runtimeDir "$name.log"
    $errLog = Join-Path $runtimeDir "$name.err.log"
    $process = Start-Process -FilePath $npm.Source -ArgumentList @("run", "tag-worker") -WorkingDirectory $RootDir -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
    Write-MemSenseLog "host $name started pid=$($process.Id)"
  }
  Write-MemSenseLog "tag-worker concurrency: $concurrency"
  Write-MemSenseLog "host tag-worker DB: $($env:MEMSENSE_DATABASE_URL)"
}

function Wait-MemSenseApi {
  $hostPort = Read-EnvValue "MEMSENSE_HOST_PORT"
  if ([string]::IsNullOrWhiteSpace($hostPort)) {
    $hostPort = Read-EnvValue "MEMSENSE_PORT"
  }
  if ([string]::IsNullOrWhiteSpace($hostPort)) {
    $hostPort = "8787"
  }
  Wait-HttpOk "http://127.0.0.1:$hostPort/healthz" "MemSense API"
}

if (-not (Test-Path -LiteralPath $EnvPath)) {
  Fail "missing .env; run the install bootstrap first"
}

$Strategy = Detect-Strategy
if ($Strategy -ne "local" -and $Strategy -ne "openai") {
  Fail "invalid strategy: $Strategy. Usage: .\scripts\update.ps1 [local|openai]"
}

Write-MemSenseLog "runtime: docker"
Write-MemSenseLog "embedding mode: $Strategy"

if (-not $DryRun -and -not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker Desktop is required for scripts/update.ps1"
}

$UseHostTagWorker = Test-HostTagWorkerAvailable
if (-not $UseHostTagWorker) {
  Write-MemSenseLog "host OpenClaw tagger not available; Docker tag-worker will run and auto mode will skip tagging unless MEMSENSE_TAGGER_PROVIDER=openai is configured"
}

if ($Strategy -eq "openai") {
  if ($UseHostTagWorker) {
    Invoke-Step "docker" @("compose", "up", "-d", "--build", "postgres", "server", "worker")
    Wait-MemSenseApi
    Start-HostTagWorker
  } else {
    Invoke-Step "docker" @("compose", "up", "-d", "--build", "postgres", "server", "worker", "tag-worker")
  }
} else {
  $env:MEMSENSE_BGE_ENDPOINT = "http://bge:8080/embed"
  if ($UseHostTagWorker) {
    Invoke-Step "docker" @("compose", "--profile", "local-bge", "up", "-d", "--build", "postgres", "server", "worker", "bge")
    Wait-MemSenseApi
    Start-HostTagWorker
  } else {
    Invoke-Step "docker" @("compose", "--profile", "local-bge", "up", "-d", "--build")
  }
  $bgeHostPort = Read-EnvValue "MEMSENSE_BGE_HOST_PORT"
  if ([string]::IsNullOrWhiteSpace($bgeHostPort)) {
    $bgeHostPort = "8088"
  }
  Wait-HttpOk "http://127.0.0.1:$bgeHostPort/healthz" "BGE embedding service"
}

if ($SkipPlugin) {
  Write-MemSenseLog "skipping OpenClaw plugin reinstall"
} elseif ($DryRun -or (Get-Command openclaw -ErrorAction SilentlyContinue)) {
  $installer = Join-Path $ScriptDir "install-openclaw-plugin.ps1"
  $powerShellCommand = Resolve-PowerShellCommand
  Invoke-Step $powerShellCommand @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installer, "-Force")
} else {
  Write-MemSenseLog "openclaw CLI not found; service updated, plugin reinstall skipped"
}

$hostPort = Read-EnvValue "MEMSENSE_HOST_PORT"
if ([string]::IsNullOrWhiteSpace($hostPort)) {
  $hostPort = Read-EnvValue "MEMSENSE_PORT"
}
if ([string]::IsNullOrWhiteSpace($hostPort)) {
  $hostPort = "8787"
}

Write-MemSenseLog "update complete"
Write-MemSenseLog "dashboard: http://127.0.0.1:$hostPort/dashboard?token=demo"
