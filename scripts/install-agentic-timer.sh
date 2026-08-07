#!/usr/bin/env bash
# Install or uninstall a user-level 30-minute CarpeOS agentic Flash batch timer.
# Product path: deepseek-v4-flash via carpeos (loads ~/.carpeos/v5-provider.env).
# Capture never runs LLM. Does not put secrets into the unit file.
set -euo pipefail

ACTION="${1:-status}"
INTERVAL_SEC="${CARPEOS_AGENTIC_INTERVAL_SEC:-1800}"
SPEND_CAP_USD="${CARPEOS_AGENTIC_SPEND_CAP_USD:-1}"
LABEL="com.innocarpe.carpeos.agentic"
HOME_DIR="${HOME}"
CARPEOS_HOME="${CARPEOS_HOME:-${HOME_DIR}/.carpeos}"
CARPEOS_BIN="${CARPEOS_BIN:-$(command -v carpeos || true)}"
if [[ -z "${CARPEOS_BIN}" ]]; then
  CARPEOS_BIN="${HOME_DIR}/.local/bin/carpeos"
fi

usage() {
  cat <<EOF
Usage: $0 install|uninstall|status

Installs a 30-minute (default) Flash batch runner:
  carpeos agentic run --once --materialize --allow-network --spend-cap-usd ${SPEND_CAP_USD}

Product path uses deepseek-v4-flash. carpeos loads DEEPSEEK_API_KEY from the
environment or from \$CARPEOS_HOME/v5-provider.env (never written into the unit).

Env:
  CARPEOS_BIN                     path to carpeos (default: which carpeos)
  CARPEOS_HOME                    runtime home (default: ~/.carpeos)
  CARPEOS_AGENTIC_INTERVAL_SEC    seconds between runs (default: 1800)
  CARPEOS_AGENTIC_SPEND_CAP_USD   per-run spend cap passed to CLI (default: 1)
  CARPEOS_AGENTIC=off             kills runner work even if timer fires
  CARPEOS_AGENTIC_NETWORK=off     force offline even with --allow-network
EOF
}

install_macos() {
  local plist="${HOME_DIR}/Library/LaunchAgents/${LABEL}.plist"
  local node_bin_dir=""
  if command -v node >/dev/null 2>&1; then
    node_bin_dir="$(dirname "$(command -v node)")"
  fi
  mkdir -p "${HOME_DIR}/Library/LaunchAgents"
  mkdir -p "${CARPEOS_HOME}/logs"
  cat >"${plist}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${CARPEOS_BIN}</string>
    <string>agentic</string>
    <string>run</string>
    <string>--once</string>
    <string>--materialize</string>
    <string>--allow-network</string>
    <string>--spend-cap-usd</string>
    <string>${SPEND_CAP_USD}</string>
    <string>--home</string>
    <string>${CARPEOS_HOME}</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_SEC}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${CARPEOS_HOME}/logs/agentic-timer.log</string>
  <key>StandardErrorPath</key>
  <string>${CARPEOS_HOME}/logs/agentic-timer.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME_DIR}</string>
    <key>CARPEOS_HOME</key>
    <string>${CARPEOS_HOME}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:${HOME_DIR}/.local/bin:${node_bin_dir}</string>
  </dict>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "${plist}"
  launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  echo "installed launchd agent ${LABEL} interval=${INTERVAL_SEC}s flash=on spend_cap_usd=${SPEND_CAP_USD} bin=${CARPEOS_BIN} home=${CARPEOS_HOME}"
  if [[ ! -f "${CARPEOS_HOME}/v5-provider.env" ]] && [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
    echo "warning: no DEEPSEEK_API_KEY in env and ${CARPEOS_HOME}/v5-provider.env missing — Flash calls will fail until credentials are set" >&2
  fi
}

uninstall_macos() {
  local plist="${HOME_DIR}/Library/LaunchAgents/${LABEL}.plist"
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  rm -f "${plist}"
  echo "uninstalled ${LABEL}"
}

status_macos() {
  if launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1; then
    echo "status=loaded label=${LABEL}"
    launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | head -30 || true
  else
    echo "status=not_loaded label=${LABEL}"
  fi
}

install_linux() {
  local unit_dir="${HOME_DIR}/.config/systemd/user"
  mkdir -p "${unit_dir}"
  mkdir -p "${CARPEOS_HOME}/logs"
  cat >"${unit_dir}/carpeos-agentic.service" <<UNIT
[Unit]
Description=CarpeOS agentic Flash batch drain (ADR 0018)
[Service]
Type=oneshot
Environment=HOME=${HOME_DIR}
Environment=CARPEOS_HOME=${CARPEOS_HOME}
# Credentials loaded by carpeos from \$CARPEOS_HOME/v5-provider.env — not embedded here.
ExecStart=${CARPEOS_BIN} agentic run --once --materialize --allow-network --spend-cap-usd ${SPEND_CAP_USD} --home ${CARPEOS_HOME}
StandardOutput=append:${CARPEOS_HOME}/logs/agentic-timer.log
StandardError=append:${CARPEOS_HOME}/logs/agentic-timer.err
UNIT
  cat >"${unit_dir}/carpeos-agentic.timer" <<UNIT
[Unit]
Description=CarpeOS agentic 30m Flash timer
[Timer]
OnBootSec=2min
OnUnitActiveSec=${INTERVAL_SEC}
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now carpeos-agentic.timer
  echo "installed systemd user timer interval=${INTERVAL_SEC}s flash=on spend_cap_usd=${SPEND_CAP_USD}"
  if [[ ! -f "${CARPEOS_HOME}/v5-provider.env" ]] && [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
    echo "warning: no DEEPSEEK_API_KEY in env and ${CARPEOS_HOME}/v5-provider.env missing — Flash calls will fail until credentials are set" >&2
  fi
}

uninstall_linux() {
  systemctl --user disable --now carpeos-agentic.timer 2>/dev/null || true
  rm -f "${HOME_DIR}/.config/systemd/user/carpeos-agentic.timer"
  rm -f "${HOME_DIR}/.config/systemd/user/carpeos-agentic.service"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "uninstalled systemd user timer"
}

status_linux() {
  systemctl --user status carpeos-agentic.timer --no-pager 2>/dev/null || echo "status=not_loaded"
}

case "${ACTION}" in
  install)
    if [[ "$(uname -s)" == "Darwin" ]]; then install_macos; else install_linux; fi
    ;;
  uninstall)
    if [[ "$(uname -s)" == "Darwin" ]]; then uninstall_macos; else uninstall_linux; fi
    ;;
  status)
    if [[ "$(uname -s)" == "Darwin" ]]; then status_macos; else status_linux; fi
    ;;
  -h|--help|help) usage ;;
  *) usage; exit 2 ;;
esac
