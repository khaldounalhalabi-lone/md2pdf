#!/usr/bin/env bash
# md2pdf installer — Ubuntu / Debian / any Linux (works on macOS too).
#
#   ./install.sh                 install as a Deno-managed command (small, fast)
#   ./install.sh --compile       build a self-contained binary instead
#   ./install.sh --uninstall     remove it again
#
# Run ./install.sh --help for every option.
set -euo pipefail

NAME="md2pdf"

# Where to fetch main.ts from when this script runs without a checkout next to
# it — i.e. the `curl … | bash` install. Override with --source or $MD2PDF_SOURCE.
REPO="${MD2PDF_REPO:-YOUR-USER/md-to-pdf}"
BRANCH="${MD2PDF_BRANCH:-master}"
SOURCE="${MD2PDF_SOURCE:-https://raw.githubusercontent.com/$REPO/$BRANCH/main.ts}"

# `curl | bash` has no real script path, so this may not be a checkout at all.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]:-.}")" 2>/dev/null && pwd || echo "$PWD")"
LOCAL_ENTRY="$SCRIPT_DIR/main.ts"

MODE="shim"          # shim | compile
ROOT="${DENO_INSTALL_ROOT:-$HOME/.deno}"
ROOT_EXPLICIT=0
SOURCE_EXPLICIT=0
ASSUME_YES=0
UNINSTALL=0

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

# Ask a yes/no question; --yes answers everything with "yes". Under
# `curl … | bash` stdin is the script itself, so questions are read from the
# terminal directly; with no terminal at all we take the safe default (no).
confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  local input="/dev/stdin"
  if [ ! -t 0 ]; then
    [ -r /dev/tty ] || return 1
    input="/dev/tty"
  fi
  printf '  %s?%s %s %s(y/N)%s ' "$CYAN" "$RESET" "$1" "$DIM" "$RESET"
  local answer=""
  read -r answer <"$input" || return 1
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

usage() {
  cat <<EOF

  ${BOLD}${MAGENTA}${NAME}${RESET} installer ${DIM}— Markdown (with PlantUML) → single-page PDF${RESET}

  ${BOLD}USAGE${RESET}
    ./install.sh [options]

  ${BOLD}OPTIONS${RESET}
    ${CYAN}--compile${RESET}        Build a standalone binary (~120 MB, no Deno needed to run,
                     survives moving or deleting this folder)
    ${CYAN}--root DIR${RESET}       Install root; the command lands in DIR/bin
                     ${DIM}(default: \$DENO_INSTALL_ROOT or ~/.deno, and ~/.local for --compile)${RESET}
    ${CYAN}--name NAME${RESET}      Command name ${DIM}(default: ${NAME})${RESET}
    ${CYAN}--source URL${RESET}     Install from this main.ts instead of the bundled default
                     ${DIM}(default: ${SOURCE})${RESET}
    ${CYAN}--uninstall${RESET}      Remove a previous installation
    ${CYAN}-y, --yes${RESET}        Answer yes to every prompt ${DIM}(unattended installs)${RESET}
    ${CYAN}-h, --help${RESET}       Show this help

  ${BOLD}NOTES${RESET}
    Deno is installed automatically if it is missing. Run from a checkout, the
    command points at that folder's main.ts, so ${CYAN}git pull${RESET} updates it — but do
    not move the folder afterwards. Run via ${CYAN}curl${RESET} with no checkout around, it
    installs straight from the URL above and updates by re-running this script.
    Diagrams are rendered by plantuml.com, and the first PDF may download a
    headless Chromium if no Chrome is installed.

EOF
}

# ── arguments ─────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --compile)   MODE="compile" ;;
    --root)      ROOT="${2:?--root needs a directory}"; ROOT_EXPLICIT=1; shift ;;
    --name)      NAME="${2:?--name needs a value}"; shift ;;
    --source)    SOURCE="${2:?--source needs a URL or path}"; SOURCE_EXPLICIT=1; shift ;;
    --uninstall) UNINSTALL=1 ;;
    -y|--yes)    ASSUME_YES=1 ;;
    -h|--help)   usage; exit 0 ;;
    *)           usage; die "Unknown option $1" ;;
  esac
  shift
done

# A compiled binary is not managed by Deno, so it belongs in a normal bin dir.
if [ "$MODE" = "compile" ] && [ "$ROOT_EXPLICIT" -eq 0 ]; then
  ROOT="$HOME/.local"
fi
BIN_DIR="$ROOT/bin"
TARGET="$BIN_DIR/$NAME"

printf '\n  %s%s%s%s  installer%s\n\n' "$BOLD" "$MAGENTA" "$NAME" "$RESET" "$RESET"

# ── uninstall ─────────────────────────────────────────────────────────────
if [ "$UNINSTALL" -eq 1 ]; then
  # Both modes end up at the same path; `deno uninstall` also clears Deno's
  # own bookkeeping, so try it first and fall back to a plain delete.
  if [ -e "$TARGET" ]; then
    if ! { command -v deno >/dev/null 2>&1 &&
      deno uninstall --global --root "$ROOT" "$NAME" >/dev/null 2>&1; }; then
      rm -f "$TARGET"
    fi
    ok "Removed $TARGET"
  else
    warn "Nothing to remove in $BIN_DIR"
  fi
  printf '\n'
  exit 0
fi

# ── 0. what are we installing? ────────────────────────────────────────────
# A checkout next to this script wins, unless --source says otherwise.
if [ "$SOURCE_EXPLICIT" -eq 0 ] && [ -f "$LOCAL_ENTRY" ]; then
  ENTRY="$LOCAL_ENTRY"
  ok "Source  ${DIM}${ENTRY}${RESET}"
else
  ENTRY="$SOURCE"
  case "$ENTRY" in
    http://*|https://*)
      case "$ENTRY" in
        *YOUR-USER*)
          die "This installer still has a placeholder repository in it.
    Set the real one, e.g.:  MD2PDF_REPO=owner/repo bash install.sh" ;;
      esac
      ok "Source  ${DIM}${ENTRY}${RESET}" ;;
    *)
      [ -f "$ENTRY" ] || die "No such entry point: $ENTRY"
      ok "Source  ${DIM}${ENTRY}${RESET}" ;;
  esac
fi

# ── 1. Deno ───────────────────────────────────────────────────────────────
if ! command -v deno >/dev/null 2>&1 && [ -x "$HOME/.deno/bin/deno" ]; then
  export PATH="$HOME/.deno/bin:$PATH"
fi

if command -v deno >/dev/null 2>&1; then
  ok "Deno found  ${DIM}$(deno --version | head -1)${RESET}"
else
  warn "Deno is not installed"
  confirm "Install Deno now (from deno.land)?" ||
    die "Deno is required. Install it with: curl -fsSL https://deno.land/install.sh | sh"

  for tool in curl unzip; do
    command -v "$tool" >/dev/null 2>&1 ||
      die "'$tool' is required to install Deno. Try: sudo apt install -y curl unzip"
  done

  step "Installing Deno…"
  curl -fsSL https://deno.land/install.sh | sh -s -- -y >/dev/null
  export PATH="${DENO_INSTALL:-$HOME/.deno}/bin:$PATH"
  command -v deno >/dev/null 2>&1 || die "Deno installation failed"
  ok "Deno installed  ${DIM}$(deno --version | head -1)${RESET}"
fi

# ── 2. install md2pdf ─────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"

if [ "$MODE" = "compile" ]; then
  step "Building a standalone binary (this takes a minute)…"
  deno compile --allow-all --quiet --output "$TARGET" "$ENTRY"
  ok "Built $TARGET"
else
  step "Installing the ${NAME} command…"
  deno install --global --force --quiet --allow-all \
    --name "$NAME" --root "$ROOT" "$ENTRY"
  ok "Installed $TARGET"
fi

# ── 3. PATH ───────────────────────────────────────────────────────────────
case ":$PATH:" in
  *":$BIN_DIR:"*) on_path=1 ;;
  *)              on_path=0 ;;
esac

if [ "$on_path" -eq 0 ]; then
  case "${SHELL##*/}" in
    zsh)  rc="$HOME/.zshrc" ;;
    fish) rc="" ;;
    *)    rc="$HOME/.bashrc" ;;
  esac
  line="export PATH=\"$BIN_DIR:\$PATH\""

  warn "$BIN_DIR is not on your PATH"
  if [ -n "$rc" ] && confirm "Add it to ${rc##*/}?"; then
    printf '\n# added by the %s installer\n%s\n' "$NAME" "$line" >>"$rc"
    ok "Updated $rc  ${DIM}(open a new terminal, or: source $rc)${RESET}"
  else
    printf '    %sAdd this to your shell config:%s  %s\n' "$DIM" "$RESET" "$line"
  fi
fi

# ── 4. verify ─────────────────────────────────────────────────────────────
if version="$("$TARGET" --version 2>/dev/null)"; then
  ok "Verified  ${DIM}${version}${RESET}"
else
  warn "Installed, but '$TARGET --version' did not run — try it manually"
fi

printf '\n  %sDone.%s  Run %s%s%s to start, or %s%s --help%s for the options.\n\n' \
  "$BOLD$GREEN" "$RESET" "$CYAN" "$NAME" "$RESET" "$CYAN" "$NAME" "$RESET"
