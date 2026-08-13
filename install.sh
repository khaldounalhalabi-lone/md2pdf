#!/usr/bin/env bash
# md2pdf installer — Ubuntu / Debian / any Linux, and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/khaldounalhalabi-lone/md2pdf/main/install.sh | bash
#
# Downloads the prebuilt md2pdf binary, puts it in ~/.local/bin, and makes sure
# that directory is on your PATH. No options, no Deno, nothing to configure.
set -euo pipefail

NAME="md2pdf"
REPO="${MD2PDF_REPO:-khaldounalhalabi-lone/md2pdf}"
BRANCH="${MD2PDF_BRANCH:-main}"
BIN_DIR="$HOME/.local/bin"
TARGET="$BIN_DIR/$NAME"

# ── output helpers ────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; CYAN=$'\033[36m'; MAGENTA=$'\033[35m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; CYAN=""; MAGENTA=""; RESET=""
fi

step() { printf '  %s→%s %s\n' "$CYAN" "$RESET" "$1"; }
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()  { printf '\n  %s✗%s %s\n\n' "$RED" "$RESET" "$1" >&2; exit 1; }

printf '\n  %s%s%s%s  installer%s\n\n' "$BOLD" "$MAGENTA" "$NAME" "$RESET" "$RESET"

# ── 1. which build do we need? ────────────────────────────────────────────
case "$(uname -s)" in
  Linux)  os="linux" ;;
  Darwin) os="macos" ;;
  *)      die "Unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64|amd64)  arch="x86_64" ;;
  arm64|aarch64) arch="aarch64" ;;
  *)             die "Unsupported architecture: $(uname -m)" ;;
esac

ASSET="$NAME-$os-$arch"
URL="https://github.com/$REPO/releases/latest/download/$ASSET"

command -v curl >/dev/null 2>&1 ||
  die "'curl' is required. Try: sudo apt install -y curl"

# ── 2. fetch it ───────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
TEMP="$(mktemp "${TMPDIR:-/tmp}/$NAME.XXXXXX")"
trap 'rm -f "$TEMP"' EXIT

step "Downloading $ASSET…"
# curl's own error goes to /dev/null: the fallback below explains it better.
if curl -fsSL --retry 2 -o "$TEMP" "$URL" 2>/dev/null; then
  chmod +x "$TEMP"
  mv -f "$TEMP" "$TARGET"
  ok "Installed $TARGET"
elif command -v deno >/dev/null 2>&1; then
  # No published build for this platform — but Deno is already here, so build
  # one, from the checkout this script sits in if there is one.
  warn "No prebuilt binary at $URL"
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || echo "$PWD")"
  if [ -f "$SCRIPT_DIR/main.ts" ]; then
    ENTRY="$SCRIPT_DIR/main.ts"
  else
    ENTRY="https://raw.githubusercontent.com/$REPO/$BRANCH/main.ts"
  fi
  step "Building one with Deno from $ENTRY (this takes a minute)…"
  deno compile --allow-all --quiet --output "$TARGET" "$ENTRY"
  ok "Built $TARGET"
else
  die "Could not download $URL
    No release build for $os-$arch, and Deno is not installed to build one.
    Install Deno from https://deno.com and re-run this script."
fi

# ── 3. PATH ───────────────────────────────────────────────────────────────
case ":$PATH:" in
  *":$BIN_DIR:"*) ok "$BIN_DIR is already on your PATH" ;;
  *)
    case "${SHELL##*/}" in
      zsh)  RC="$HOME/.zshrc" ;;
      bash) RC="$HOME/.bashrc" ;;
      *)    RC="$HOME/.profile" ;;
    esac
    LINE="export PATH=\"$BIN_DIR:\$PATH\""

    if [ -f "$RC" ] && grep -qF "$BIN_DIR" "$RC"; then
      ok "PATH entry already present in ${RC##*/}"
    else
      printf '\n# added by the %s installer\n%s\n' "$NAME" "$LINE" >>"$RC"
      ok "Added $BIN_DIR to your PATH in ${RC##*/}"
    fi
    export PATH="$BIN_DIR:$PATH"
    NEEDS_RELOAD="$RC"
    ;;
esac

# ── 4. verify ─────────────────────────────────────────────────────────────
if version="$("$TARGET" --version 2>/dev/null)"; then
  ok "Verified  ${DIM}${version}${RESET}"
else
  warn "Installed, but '$TARGET --version' did not run — try it manually"
fi

printf '\n  %sDone.%s  Run %s%s%s to start, or %s%s --help%s for the options.\n' \
  "$BOLD$GREEN" "$RESET" "$CYAN" "$NAME" "$RESET" "$CYAN" "$NAME" "$RESET"
if [ -n "${NEEDS_RELOAD:-}" ]; then
  printf '  %sIn this terminal, first run:%s  source %s\n' \
    "$DIM" "$RESET" "$NEEDS_RELOAD"
fi
printf '\n'
