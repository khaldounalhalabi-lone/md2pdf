<#
.SYNOPSIS
  md2pdf installer for Windows (PowerShell 5.1+).

.DESCRIPTION
  Downloads the prebuilt md2pdf binary, puts it in
  %LOCALAPPDATA%\Programs\md2pdf, and adds that directory to your user PATH so
  `md2pdf` works in any new terminal. No options, no Deno, nothing to configure.

.EXAMPLE
  irm https://raw.githubusercontent.com/khaldounalhalabi-lone/md2pdf/main/install.ps1 | iex

.NOTES
  If Windows blocks the script file, run it as:
    powershell -ExecutionPolicy Bypass -File .\install.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Name = "md2pdf"
$Repo = if ($env:MD2PDF_REPO) { $env:MD2PDF_REPO } else { "khaldounalhalabi-lone/md2pdf" }
$Branch = if ($env:MD2PDF_BRANCH) { $env:MD2PDF_BRANCH } else { "main" }
$BinDir = Join-Path $env:LOCALAPPDATA "Programs\$Name"
$Target = Join-Path $BinDir "$Name.exe"

# ── output helpers ────────────────────────────────────────────────────────
function Write-Step { param([string] $Message) Write-Host "  → $Message" -ForegroundColor Cyan }
function Write-Ok { param([string] $Message) Write-Host "  " -NoNewline; Write-Host "✓" -ForegroundColor Green -NoNewline; Write-Host " $Message" }
function Write-Warn { param([string] $Message) Write-Host "  " -NoNewline; Write-Host "!" -ForegroundColor Yellow -NoNewline; Write-Host " $Message" }

function Stop-WithError {
  param([string] $Message)
  Write-Host ""
  Write-Host "  ✗ $Message" -ForegroundColor Red
  Write-Host ""
  exit 1
}

Write-Host ""
Write-Host "  $Name" -ForegroundColor Magenta -NoNewline
Write-Host "  installer"
Write-Host ""

# ── 1. which build do we need? ────────────────────────────────────────────
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "aarch64" } else { "x86_64" }
$asset = "$Name-windows-$arch.exe"
$url = "https://github.com/$Repo/releases/latest/download/$asset"

# ── 2. fetch it ───────────────────────────────────────────────────────────
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$temp = Join-Path ([System.IO.Path]::GetTempPath()) "$Name-$([System.IO.Path]::GetRandomFileName()).exe"

Write-Step "Downloading $asset…"
$downloaded = $false
try {
  # Some older hosts default to TLS 1.0, which github.com refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $temp -UseBasicParsing
  Move-Item -Force -Path $temp -Destination $Target
  $downloaded = $true
  Write-Ok "Installed $Target"
} catch {
  Write-Warn "No prebuilt binary at $url"
}

if (-not $downloaded) {
  # No published build for this platform — but if Deno is here, build one.
  if (Get-Command deno -ErrorAction SilentlyContinue) {
    Write-Step "Building one locally with Deno (this takes a minute)…"
    & deno compile --allow-all --quiet --output $Target `
      "https://raw.githubusercontent.com/$Repo/$Branch/main.ts"
    if ($LASTEXITCODE -ne 0) { Stop-WithError "deno compile failed" }
    Write-Ok "Built $Target"
  } else {
    Stop-WithError ("Could not download $url`n" +
      "    No release build for windows-$arch, and Deno is not installed to build one.`n" +
      "    Install Deno from https://deno.com and re-run this script.")
  }
}

# ── 3. PATH ───────────────────────────────────────────────────────────────
$needsReload = $false   # Set-StrictMode: every variable must exist before use
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$alreadyThere = ($userPath -split ';' |
  Where-Object { $_.TrimEnd('\') -ieq $BinDir.TrimEnd('\') }).Count -gt 0

if ($alreadyThere) {
  Write-Ok "$BinDir is already on your PATH"
} else {
  $updated = if ([string]::IsNullOrEmpty($userPath)) { $BinDir } else { "$userPath;$BinDir" }
  [Environment]::SetEnvironmentVariable("Path", $updated, "User")
  Write-Ok "Added $BinDir to your PATH"
  $needsReload = $true
}
$env:Path = "$BinDir;$env:Path"

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
if ($needsReload) {
  Write-Host "  Open a new terminal for the PATH change to apply there." -ForegroundColor DarkGray
}
Write-Host ""
