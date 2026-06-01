param(
  [switch]$Force,
  [switch]$DryRun,
  [string]$PluginPath = ""
)

# Install the MemSense plugin into OpenClaw from PowerShell.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

if ([string]::IsNullOrWhiteSpace($PluginPath)) {
  $PluginPath = $RootDir
} else {
  $PluginPath = (Resolve-Path -LiteralPath $PluginPath).Path
}

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

Write-MemSenseLog "checking prerequisites..."
if (-not $DryRun) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail "'npm' not found on PATH"
  }
  if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
    Fail "'openclaw' CLI not found on PATH. Install OpenClaw and retry."
  }
}

$DistPath = Join-Path $PluginPath "dist"
if ($Force -or -not (Test-Path -LiteralPath $DistPath)) {
  Write-MemSenseLog "building plugin (npm ci && npm run build)..."
  Invoke-Step "npm" @("--prefix", $PluginPath, "ci")
  Invoke-Step "npm" @("--prefix", $PluginPath, "run", "build")
} else {
  Write-MemSenseLog "dist/ already exists; skipping build (pass -Force to rebuild)"
}

Write-MemSenseLog "installing plugin into OpenClaw..."
Invoke-Step "openclaw" @("plugins", "install", "-l", "--dangerously-force-unsafe-install", $PluginPath)

Write-MemSenseLog "enabling plugin..."
Invoke-Step "openclaw" @("plugins", "enable", "memsense")

Write-MemSenseLog "granting conversation access..."
Invoke-Step "openclaw" @("config", "set", "plugins.entries.memsense.hooks.allowConversationAccess", "true")

Write-MemSenseLog "binding memory slot..."
Invoke-Step "openclaw" @("config", "set", "plugins.entries.memsense.enabled", "true")
Invoke-Step "openclaw" @("config", "set", "plugins.slots.memory", "memsense")

Write-MemSenseLog "restarting OpenClaw gateway..."
Invoke-Step "openclaw" @("gateway", "restart")

Write-MemSenseLog "verifying installation..."
if ($DryRun) {
  Write-MemSenseLog "(dry-run) openclaw plugins list"
} else {
  $pluginList = & openclaw plugins list 2>$null
  if ($pluginList -match "memsense") {
    Write-MemSenseLog "memsense plugin found in plugin list"
  } else {
    Write-MemSenseLog "warning: memsense not found in 'openclaw plugins list'; check gateway logs"
  }
}

Write-Host ""
Write-Host "MemSense plugin installed"
Write-Host "plugin path: $PluginPath"
Write-Host "config keys set:"
Write-Host "  plugins.entries.memsense.hooks.allowConversationAccess"
Write-Host "  plugins.entries.memsense.enabled"
Write-Host "  plugins.slots.memory = memsense"
Write-Host "Next step: open http://127.0.0.1:8787/dashboard?token=demo"
