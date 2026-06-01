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

Set-EnvValue "MEMSENSE_PORT" "8787"
Set-EnvValue "MEMSENSE_HOST_PORT" $HostPort
Set-EnvValue "MEMSENSE_API_URL" "http://127.0.0.1:$HostPort"
Set-EnvValue "MEMSENSE_DASHBOARD_TOKENS_JSON" '{"demo":"admin"}'

if ($Strategy -eq "openai") {
  Write-MemSenseLog "starting with OPENAI-compatible embedding strategy"
  Set-EnvValue "MEMSENSE_EMBEDDING_PROVIDER" "openai"
  Write-MemSenseLog "ensure MEMSENSE_OPENAI_API_KEY is set in .env"
  Invoke-Step "docker" @("compose", "build", "server")
  Invoke-Step "docker" @("compose", "up", "-d", "postgres", "server", "worker", "tag-worker")
} else {
  Write-MemSenseLog "starting with LOCAL BGE strategy (auto model pull on first run)"
  Set-EnvValue "MEMSENSE_EMBEDDING_PROVIDER" "bge_http"
  Set-EnvValue "MEMSENSE_BGE_ENDPOINT" "http://bge:8080/embed"
  Set-EnvValue "MEMSENSE_BGE_MODEL" "BAAI/bge-large-zh-v1.5"
  Invoke-Step "docker" @("compose", "--profile", "local-bge", "build", "server", "bge")
  Invoke-Step "docker" @("compose", "--profile", "local-bge", "up", "-d")
}

Write-MemSenseLog "done. Check services with: docker compose ps"
