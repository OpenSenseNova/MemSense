param(
  [switch]$Force,
  [switch]$DryRun,
  [string]$PluginPath = ""
)

# Install the MemSense plugin into OpenClaw from PowerShell.
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

function Show-UsageAndExit {
  param([int]$ExitCode = 0)
  Write-Host "Usage:"
  Write-Host "  .\scripts\install-openclaw-plugin.ps1 [-Force] [-DryRun] [-PluginPath <path>]"
  Write-Host "  .\scripts\install-openclaw-plugin.ps1 [--force] [--dry-run] [--plugin-path <path>]"
  exit $ExitCode
}

if ($args.Count -gt 0) {
  for ($i = 0; $i -lt $args.Count; $i++) {
    $arg = [string]$args[$i]
    if ($arg -eq "--force") {
      $Force = $true
      continue
    }
    if ($arg -eq "--dry-run") {
      $DryRun = $true
      continue
    }
    if ($arg -eq "--plugin-path") {
      if ($i + 1 -ge $args.Count) {
        Write-Host "[memsense] missing value for --plugin-path" -ForegroundColor Red
        Show-UsageAndExit 1
      }
      $i++
      $PluginPath = [string]$args[$i]
      continue
    }
    if ($arg.StartsWith("--plugin-path=")) {
      $PluginPath = $arg.Substring("--plugin-path=".Length)
      continue
    }
    if ($arg -eq "--help" -or $arg -eq "-h") {
      Show-UsageAndExit 0
    }

    Write-Host "[memsense] unknown option: $arg" -ForegroundColor Red
    Show-UsageAndExit 1
  }
}

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

function Resolve-NativeCommand {
  param([string]$Name)

  if ($env:OS -eq "Windows_NT") {
    foreach ($candidate in @("$Name.cmd", "$Name.exe", "$Name.bat")) {
      $command = Get-Command $candidate -ErrorAction SilentlyContinue
      if ($command) {
        return $command.Source
      }
    }
  }

  $fallback = Get-Command $Name -ErrorAction SilentlyContinue
  if ($fallback) {
    return $fallback.Source
  }

  return $null
}

function Invoke-Step {
  param(
    [string]$FilePath,
    [string[]]$Arguments = @(),
    [switch]$AllowFailure
  )
  $display = (@($FilePath) + $Arguments) -join " "
  if ($DryRun) {
    Write-MemSenseLog "(dry-run) $display"
    if ($AllowFailure) {
      return $true
    }
    return
  }

  Write-MemSenseLog "running: $display"
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    if ($AllowFailure) {
      return $false
    }
    Fail "command failed: $display"
  }
  if ($AllowFailure) {
    return $true
  }
}

Write-MemSenseLog "checking prerequisites..."
$NpmCommand = Resolve-NativeCommand "npm"
$OpenClawCommand = Resolve-NativeCommand "openclaw"
if (-not $DryRun) {
  if (-not $NpmCommand) {
    Fail "'npm' not found on PATH"
  }
  if (-not $OpenClawCommand) {
    Fail "'openclaw' CLI not found on PATH. Install OpenClaw and retry."
  }
}
$NpmCommand = if ($NpmCommand) { $NpmCommand } else { "npm" }
$OpenClawCommand = if ($OpenClawCommand) { $OpenClawCommand } else { "openclaw" }

$DistPath = Join-Path $PluginPath "dist"
if ($Force -or -not (Test-Path -LiteralPath $DistPath)) {
  Write-MemSenseLog "building plugin (npm ci && npm run build)..."
  Invoke-Step $NpmCommand @("--prefix", $PluginPath, "ci", "--no-audit", "--no-fund")
  Invoke-Step $NpmCommand @("--prefix", $PluginPath, "run", "build")
} else {
  Write-MemSenseLog "dist/ already exists; skipping build (pass -Force to rebuild)"
}

Write-MemSenseLog "installing plugin into OpenClaw..."
Invoke-Step $OpenClawCommand @("plugins", "install", "-l", "--dangerously-force-unsafe-install", $PluginPath)

Write-MemSenseLog "enabling plugin..."
Invoke-Step $OpenClawCommand @("plugins", "enable", "memsense")

Write-MemSenseLog "granting conversation access..."
Invoke-Step $OpenClawCommand @("config", "set", "plugins.entries.memsense.hooks.allowConversationAccess", "true")

Write-MemSenseLog "binding memory slot..."
Invoke-Step $OpenClawCommand @("config", "set", "plugins.entries.memsense.enabled", "true")
Invoke-Step $OpenClawCommand @("config", "set", "plugins.slots.memory", "memsense")

Write-MemSenseLog "restarting OpenClaw gateway..."
$Restarted = Invoke-Step $OpenClawCommand @("gateway", "restart") -AllowFailure
if (-not $Restarted) {
  Write-MemSenseLog "warning: OpenClaw gateway restart failed."
  Write-MemSenseLog "The plugin was installed and configured; restart OpenClaw manually to load it."
  Write-MemSenseLog "Try: openclaw gateway restart"
}

Write-MemSenseLog "verifying installation..."
if ($DryRun) {
  Write-MemSenseLog "(dry-run) openclaw plugins list"
} else {
  $pluginList = & $OpenClawCommand plugins list 2>$null
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
