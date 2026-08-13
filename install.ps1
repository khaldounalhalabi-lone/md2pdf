<#
.SYNOPSIS
  md2pdf installer for Windows (PowerShell 5.1+).

.DESCRIPTION
  Installs the md2pdf command, installing Deno first if it is missing.
  Run from a checkout, the command points at that folder's main.ts, so
  `git pull` updates it. Run through `irm | iex` with no checkout around, it
  installs straight from the project URL. -Compile builds a standalone binary
  that keeps working if the folder moves or is deleted.

.EXAMPLE
  .\install.ps1
.EXAMPLE
  .\install.ps1 -Compile
.EXAMPLE
  .\install.ps1 -Uninstall
.EXAMPLE
  irm https://raw.githubusercontent.com/YOUR-USER/md-to-pdf/master/install.ps1 | iex

.NOTES
  If Windows blocks the script, run it as:
    powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
  # Build a standalone ~120 MB binary instead of a Deno-managed shim.
  [switch] $Compile,
  # Install root; the command lands in <Root>\bin.
  [string] $Root,
  # Command name.
  [string] $Name = "md2pdf",
  # Remove a previous installation.
  [switch] $Uninstall,
  # Install from this main.ts (URL or path) instead of the bundled default.
  [string] $Source,
  # Answer yes to every prompt (unattended installs).
  [switch] $Yes
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Where to fetch main.ts from when there is no checkout around this script —
# i.e. the `irm … | iex` install.
$Repo = if ($env:MD2PDF_REPO) { $env:MD2PDF_REPO } else { "YOUR-USER/md-to-pdf" }
$Branch = if ($env:MD2PDF_BRANCH) { $env:MD2PDF_BRANCH } else { "master" }
$DefaultSource = "https://raw.githubusercontent.com/$Repo/$Branch/main.ts"

# Run through `iex` there is no script path at all, so this may not be a checkout.
$ScriptPath = $MyInvocation.MyCommand.Path
$ScriptDir = if ($ScriptPath) { Split-Path -Parent $ScriptPath } else { $PWD.Path }
$LocalEntry = Join-Path $ScriptDir "main.ts"

# ── output helpers ────────────────────────────────────────────────────────
function Write-Step { param([string] $Message) Write-Host "  → $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Message) Write-Host "  " -NoNewline; Write-Host "✓" -ForegroundColor Green -NoNewline; Write-Host " $Message" }
function Write-Warn { param([string] $Message) Write-Host "  " -NoNewline; Write-Host "!" -ForegroundColor Yellow -NoNewline; Write-Host " $Message" }
function Write-Dim  { param([string] $Message) Write-Host "    $Message" -ForegroundColor DarkGray }

function Stop-WithError {
  param([string] $Message)
  Write-Host ""
  Write-Host "  ✗ $Message" -ForegroundColor Red
  Write-Host ""
  exit 1
}

# Ask a yes/no question; -Yes answers everything, and a non-interactive host
# falls back to the safe default (no).
function Confirm-Action {
  param([string] $Question)
  if ($Yes) { return $true }
  if ([Console]::IsInputRedirected) { return $false }
  Write-Host "  ? $Question " -ForegroundColor Cyan -NoNewline
  Write-Host "(y/N) " -ForegroundColor DarkGray -NoNewline
  $answer = Read-Host
  return $answer -match '^(y|yes)$'
}

function Test-Deno {
  return [bool] (Get-Command deno -ErrorAction SilentlyContinue)
}

# ── paths ─────────────────────────────────────────────────────────────────
if (-not $Root) {
  # A compiled binary is not managed by Deno, so it belongs in its own dir.
  $Root = if ($Compile) {
    Join-Path $env:LOCALAPPDATA "Programs\$Name"
  } elseif ($env:DENO_INSTALL_ROOT) {
    $env:DENO_INSTALL_ROOT
  } else {
    Join-Path $env:USERPROFILE ".deno"
  }
}
$BinDir = Join-Path $Root "bin"
# Deno's global installs get a .cmd shim; a compiled binary is a real .exe.
$Target = Join-Path $BinDir ("$Name" + $(if ($Compile) { ".exe" } else { ".cmd" }))

Write-Host ""
Write-Host "  $Name" -ForegroundColor Magenta -NoNewline
Write-Host "  installer"
Write-Host ""

# ── uninstall ─────────────────────────────────────────────────────────────
if ($Uninstall) {
  $removed = $false
  # `deno uninstall` also clears Deno's own bookkeeping, so run it first; the
  # loop then sweeps up whatever is left (a compiled .exe, or the shim's pair
  # of files).
  if (Test-Deno) {
    & deno uninstall --global --root $Root $Name 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $removed = $true }
  }
  foreach ($candidate in @(
      (Join-Path $BinDir "$Name.exe"),
      (Join-Path $BinDir "$Name.cmd"),
      (Join-Path $BinDir $Name))) {
    if (Test-Path $candidate) {
      Remove-Item $candidate -Force
      $removed = $true
    }
  }
  if ($removed) {
    Write-Ok "Removed $Name from $BinDir"
  } else {
    Write-Warn "Nothing to remove in $BinDir"
  }
  Write-Host ""
  exit 0
}

# ── 0. what are we installing? ────────────────────────────────────────────
# A checkout next to this script wins, unless -Source says otherwise.
if (-not $Source -and (Test-Path $LocalEntry)) {
  $Entry = $LocalEntry
} else {
  $Entry = if ($Source) { $Source } else { $DefaultSource }
  if ($Entry -match '^https?://') {
    if ($Entry -match 'YOUR-USER') {
      Stop-WithError ("This installer still has a placeholder repository in it.`n" +
        "    Set the real one, e.g.:  `$env:MD2PDF_REPO = 'owner/repo'")
    }
  } elseif (-not (Test-Path $Entry)) {
    Stop-WithError "No such entry point: $Entry"
  }
}
Write-Ok "Source  $Entry"

# ── 1. Deno ───────────────────────────────────────────────────────────────
$denoBin = Join-Path $env:USERPROFILE ".deno\bin"
if (-not (Test-Deno) -and (Test-Path (Join-Path $denoBin "deno.exe"))) {
  $env:Path = "$denoBin;$env:Path"
}

if (Test-Deno) {
  Write-Ok "Deno found  $((& deno --version) | Select-Object -First 1)"
} else {
  Write-Warn "Deno is not installed"
  if (-not (Confirm-Action "Install Deno now (from deno.land)?")) {
    Stop-WithError "Deno is required. Install it with: irm https://deno.land/install.ps1 | iex"
  }
  Write-Step "Installing Deno…"
  # The official installer respects $env:DENO_INSTALL and skips its own prompts.
  $env:DENO_INSTALL = Join-Path $env:USERPROFILE ".deno"
  Invoke-RestMethod https://deno.land/install.ps1 | Invoke-Expression
  $env:Path = "$denoBin;$env:Path"
  if (-not (Test-Deno)) { Stop-WithError "Deno installation failed" }
  Write-Ok "Deno installed  $((& deno --version) | Select-Object -First 1)"
}

# ── 2. install md2pdf ─────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

if ($Compile) {
  Write-Step "Building a standalone binary (this takes a minute)…"
  & deno compile --allow-all --quiet --output $Target $Entry
  if ($LASTEXITCODE -ne 0) { Stop-WithError "deno compile failed" }
  Write-Ok "Built $Target"
} else {
  Write-Step "Installing the $Name command…"
  & deno install --global --force --quiet --allow-all --name $Name --root $Root $Entry
  if ($LASTEXITCODE -ne 0) { Stop-WithError "deno install failed" }
  Write-Ok "Installed $Target"
}

# ── 3. PATH ───────────────────────────────────────────────────────────────
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$onPath = ($userPath -split ';' | Where-Object { $_.TrimEnd('\') -ieq $BinDir.TrimEnd('\') }).Count -gt 0

if (-not $onPath) {
  Write-Warn "$BinDir is not on your PATH"
  if (Confirm-Action "Add it to your user PATH?") {
    $updated = if ([string]::IsNullOrEmpty($userPath)) { $BinDir } else { "$userPath;$BinDir" }
    [Environment]::SetEnvironmentVariable("Path", $updated, "User")
    $env:Path = "$BinDir;$env:Path"
    Write-Ok "PATH updated  (open a new terminal for it to take effect elsewhere)"
  } else {
    Write-Dim "Add this directory to your PATH manually: $BinDir"
  }
}

# ── 4. verify ─────────────────────────────────────────────────────────────
try {
  $version = & $Target --version 2>$null
  if ($LASTEXITCODE -eq 0 -and $version) {
    Write-Ok "Verified  $version"
  } else {
    Write-Warn "Installed, but '$Target --version' did not run — try it manually"
  }
} catch {
  Write-Warn "Installed, but '$Target --version' did not run — try it manually"
}

Write-Host ""
Write-Host "  Done." -ForegroundColor Green -NoNewline
Write-Host "  Run " -NoNewline
Write-Host $Name -ForegroundColor Cyan -NoNewline
Write-Host " to start, or " -NoNewline
Write-Host "$Name --help" -ForegroundColor Cyan -NoNewline
Write-Host " for the options."
Write-Host ""
