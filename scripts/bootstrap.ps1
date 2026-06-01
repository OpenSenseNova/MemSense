param(
  [string]$Strategy = "",
  [switch]$DryRun
)

# Docker-only bootstrap for PowerShell users.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
Set-Location $RootDir

$EnvPath = Join-Path $RootDir ".env"
$EnvExamplePath = Join-Path $RootDir ".env.example"
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

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

function Read-EnvLines {
  if (Test-Path -LiteralPath $EnvPath) {
    return [System.IO.File]::ReadAllLines($EnvPath)
  }
  return @()
}

function Write-EnvLines {
  param([string[]]$Lines)
  [System.IO.File]::WriteAllLines($EnvPath, $Lines, $Utf8NoBom)
}

function Set-EnvValue {
  param(
    [string]$Key,
    [string]$Value
  )
  if ($DryRun) {
    Write-MemSenseLog "set .env: $Key=$Value"
    return
  }

  $line = "$Key=$Value"
  $pattern = "^\s*$([Regex]::Escape($Key))="
  $found = $false
  $updated = @()

  foreach ($existing in (Read-EnvLines)) {
    if ($existing -match $pattern) {
      $updated += $line
      $found = $true
    } else {
      $updated += $existing
    }
  }

  if (-not $found) {
    if ($updated.Count -gt 0 -and $updated[-1] -ne "") {
      $updated += ""
    }
    $updated += $line
  }

  Write-EnvLines $updated
}

function Get-EnvValue {
  param([string]$Key)
  foreach ($line in (Read-EnvLines)) {
    if ($line -match "^\s*$([Regex]::Escape($Key))=(.*)$") {
      return $Matches[1]
    }
  }
  return ""
}

function Set-EnvDefault {
  param(
    [string]$Key,
    [string]$Value
  )
  if ([string]::IsNullOrWhiteSpace((Get-EnvValue $Key))) {
    Set-EnvValue $Key $Value
  }
}

function Test-HostTagWorkerAvailable {
  $provider = Get-EnvValue "MEMSENSE_TAGGER_PROVIDER"
  if ([string]::IsNullOrWhiteSpace($provider)) {
    $provider = "auto"
  }
  if ($provider -ne "auto" -and $provider -ne "openclaw" -and $provider -ne "openclaw_cli") {
    return $false
  }
  return [bool](Get-Command openclaw -ErrorAction SilentlyContinue) -and [bool](Get-Command npm -ErrorAction SilentlyContinue)
}

function Ensure-NodeDeps {
  if (-not (Test-Path -LiteralPath (Join-Path $RootDir "node_modules"))) {
    Write-MemSenseLog "installing Node dependencies for host tag-worker"
    Invoke-Step "npm" @("ci")
  }
}

function Get-TagWorkerConcurrency {
  $raw = if ($env:MEMSENSE_TAG_WORKER_CONCURRENCY) {
    $env:MEMSENSE_TAG_WORKER_CONCURRENCY
  } else {
    Get-EnvValue "MEMSENSE_TAG_WORKER_CONCURRENCY"
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
    Get-EnvValue "MEMSENSE_POSTGRES_PORT"
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
  $taggerProvider = if ($env:MEMSENSE_TAGGER_PROVIDER) { $env:MEMSENSE_TAGGER_PROVIDER } else { Get-EnvValue "MEMSENSE_TAGGER_PROVIDER" }
  $taggerModel = if ($env:MEMSENSE_TAGGER_MODEL) { $env:MEMSENSE_TAGGER_MODEL } else { Get-EnvValue "MEMSENSE_TAGGER_MODEL" }
  $openClawCli = if ($env:MEMSENSE_OPENCLAW_CLI) { $env:MEMSENSE_OPENCLAW_CLI } else { Get-EnvValue "MEMSENSE_OPENCLAW_CLI" }

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
  Wait-HttpOk "http://127.0.0.1:$HostPort/healthz" "MemSense API"
}

if (-not (Test-Path -LiteralPath $EnvPath)) {
  if (-not (Test-Path -LiteralPath $EnvExamplePath)) {
    Fail "missing .env.example"
  }
  if ($DryRun) {
    Write-MemSenseLog "would create .env from .env.example"
  } else {
    Copy-Item -LiteralPath $EnvExamplePath -Destination $EnvPath
    Write-MemSenseLog ".env created from .env.example"
  }
}

if ([string]::IsNullOrWhiteSpace($Strategy)) {
  Write-Host "Choose embedding strategy:"
  Write-Host "  1) openai  (OpenAI-compatible / Qwen embedding API)"
  Write-Host "  2) local   (local BGE, auto-pull model)"
  $choice = Read-Host "Enter 1 or 2"
  if ($choice -eq "1") {
    $Strategy = "openai"
  } else {
    $Strategy = "local"
  }
}

if ($Strategy -ne "openai" -and $Strategy -ne "local") {
  Fail "invalid strategy: $Strategy. Usage: .\scripts\bootstrap.ps1 [local|openai]"
}

if (-not $DryRun -and -not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker Desktop is required for scripts/bootstrap.ps1"
}

$HostPort = if ($env:MEMSENSE_HOST_PORT) {
  $env:MEMSENSE_HOST_PORT
} elseif ($env:MEMSENSE_PORT) {
  $env:MEMSENSE_PORT
} else {
  "8787"
}

$BgeHostPort = if ($env:MEMSENSE_BGE_HOST_PORT) {
  $env:MEMSENSE_BGE_HOST_PORT
} else {
  "8088"
}

Set-EnvValue "MEMSENSE_PORT" "8787"
Set-EnvValue "MEMSENSE_HOST_PORT" $HostPort
Set-EnvValue "MEMSENSE_API_URL" "http://127.0.0.1:$HostPort"
Set-EnvValue "MEMSENSE_DASHBOARD_TOKENS_JSON" '{"demo":"admin"}'
Set-EnvDefault "MEMSENSE_TAGGER_PROVIDER" "auto"
Set-EnvDefault "MEMSENSE_TAGGER_MODEL" "auto"
Set-EnvDefault "MEMSENSE_TAG_WORKER_CONCURRENCY" "3"

$UseHostTagWorker = Test-HostTagWorkerAvailable
if (-not $UseHostTagWorker) {
  Write-MemSenseLog "host OpenClaw tagger not available; Docker tag-worker will run and auto mode will skip tagging unless MEMSENSE_TAGGER_PROVIDER=openai is configured"
}

if ($Strategy -eq "openai") {
  Write-MemSenseLog "starting with OPENAI-compatible embedding strategy"
  Set-EnvValue "MEMSENSE_EMBEDDING_PROVIDER" "openai"
  Write-MemSenseLog "ensure MEMSENSE_OPENAI_API_KEY is set in .env"
  Invoke-Step "docker" @("compose", "build", "server")
  if ($UseHostTagWorker) {
    Invoke-Step "docker" @("compose", "up", "-d", "postgres", "server", "worker")
    Wait-MemSenseApi
    Start-HostTagWorker
  } else {
    Invoke-Step "docker" @("compose", "up", "-d", "postgres", "server", "worker", "tag-worker")
  }
} else {
  Write-MemSenseLog "starting with LOCAL BGE strategy (auto model pull on first run)"
  Set-EnvValue "MEMSENSE_EMBEDDING_PROVIDER" "bge_http"
  Set-EnvValue "MEMSENSE_BGE_ENDPOINT" "http://bge:8080/embed"
  Set-EnvValue "MEMSENSE_BGE_MODEL" "BAAI/bge-large-zh-v1.5"
  Invoke-Step "docker" @("compose", "--profile", "local-bge", "build", "server", "bge")
  if ($UseHostTagWorker) {
    Invoke-Step "docker" @("compose", "--profile", "local-bge", "up", "-d", "postgres", "server", "worker", "bge")
    Wait-MemSenseApi
    Start-HostTagWorker
  } else {
    Invoke-Step "docker" @("compose", "--profile", "local-bge", "up", "-d")
  }
  Wait-HttpOk "http://127.0.0.1:$BgeHostPort/healthz" "BGE embedding service"
}

Write-MemSenseLog "done. Check services with: docker compose ps"
