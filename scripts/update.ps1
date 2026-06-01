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

if ($Strategy -eq "openai") {
  Invoke-Step "docker" @("compose", "up", "-d", "--build", "postgres", "server", "worker", "tag-worker")
} else {
  $env:MEMSENSE_BGE_ENDPOINT = "http://bge:8080/embed"
  Invoke-Step "docker" @("compose", "--profile", "local-bge", "up", "-d", "--build")
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
