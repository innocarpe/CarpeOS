#!/usr/bin/env bash
# CarpeOS public installer — Codex-style one-liner:
#   curl -fsSL https://raw.githubusercontent.com/innocarpe/carpeos/main/scripts/install.sh | bash
set -euo pipefail

PREFIX="${CARPEOS_NPM_PACKAGE:-@innocarpe/carpeos}"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=22

log() { printf '%s\n' "$*"; }
err() { printf 'carpeos-install: %s\n' "$*" >&2; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "missing required command: $1"
    exit 1
  fi
}

check_node() {
  need_cmd node
  local major minor
  major="$(node -p 'process.versions.node.split(".")[0]')"
  minor="$(node -p 'process.versions.node.split(".")[1]')"
  if [ "$major" -lt "$NODE_MIN_MAJOR" ] || {
    [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -lt "$NODE_MIN_MINOR" ]
  }; then
    err "Node.js >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} required (found $(node -v))"
    exit 1
  fi
}

install_npm() {
  need_cmd npm
  log "Installing ${PREFIX} globally via npm..."
  npm install -g "$PREFIX"
}

run_setup() {
  if ! command -v carpeos >/dev/null 2>&1; then
    err "carpeos not on PATH after npm install; open a new shell or fix npm global bin PATH"
    err "npm bin -g => $(npm bin -g 2>/dev/null || true)"
    exit 1
  fi
  if [ "${CARPEOS_SKIP_SETUP:-}" = "1" ]; then
    log "Skipping setup (CARPEOS_SKIP_SETUP=1). Run later: carpeos setup --yes"
    return 0
  fi
  log "Running carpeos setup --yes..."
  carpeos setup --yes
}

main() {
  log "CarpeOS installer"
  check_node
  install_npm
  run_setup
  log ""
  log "Done. Try:"
  log "  carpeos setup --doctor"
  log "  carpeos memory context-pack --help"
}

main "$@"
