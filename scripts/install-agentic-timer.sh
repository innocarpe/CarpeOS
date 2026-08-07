#!/usr/bin/env bash
# Install or uninstall a user-level 30-minute CarpeOS agentic batch timer (ADR 0018).
# macOS: launchd. Linux: systemd --user. Does not put LLM in capture.
set -euo pipefail

ACTION="${1:-status}"
INTERVAL_SEC="${CARPEOS_AGENTIC_INTERVAL_SEC:-1800}"
LABEL="com.innocarpe.carpeos.agentic"
HOME_DIR="${HOME}"
CARPEOS_BIN="${CARPEOS_BIN:-$(command -v carpeos || true)}"
if [[ -z "${CARPEOS_BIN}" ]]; then
  CARPEOS_BIN="${HOME_DIR}/.local/bin/carpeos"
fi

usage() {
  cat <<EOF
Usage: $0 install|uninstall|status

Installs a 30-minute (default) batch runner:
  carpeos agentic run --once --materialize

Env:
  CARPEOS_BIN                 path to carpeos (default: which carpeos)
  CARPEOS_AGENTIC_INTERVAL_SEC  seconds between runs (default: 1800)
  CARPEOS_AGENTIC=off           kills runner work even if timer fires
EOF
}

install_macos() {
  local plist="${HOME_DIR}/Library/LaunchAgents/${LABEL}.plist"
  mkdir -p "${HOME_DIR}/Library/LaunchAgents"
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
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL_SEC}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME_DIR}/.carpeos/logs/agentic-timer.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME_DIR}/.carpeos/logs/agentic-timer.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:${HOME_DIR}/.local/bin:${HOME_DIR}/.nvm/versions/node/$(node -v 2>/dev/null | tr -d v || echo)/bin</string>
  </dict>
</dict>
</plist>
PLIST
  mkdir -p "${HOME_DIR}/.carpeos/logs"
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "${plist}"
  launchctl enable "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  echo "installed launchd agent ${LABEL} interval=${INTERVAL_SEC}s bin=${CARPEOS_BIN}"
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
    launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | head -20 || true
  else
    echo "status=not_loaded label=${LABEL}"
  fi
}

install_linux() {
  local unit_dir="${HOME_DIR}/.config/systemd/user"
  mkdir -p "${unit_dir}"
  cat >"${unit_dir}/carpeos-agentic.service" <<UNIT
[Unit]
Description=CarpeOS agentic batch drain (ADR 0018)
[Service]
Type=oneshot
ExecStart=${CARPEOS_BIN} agentic run --once --materialize
UNIT
  cat >"${unit_dir}/carpeos-agentic.timer" <<UNIT
[Unit]
Description=CarpeOS agentic 30m timer
[Timer]
OnBootSec=2min
OnUnitActiveSec=${INTERVAL_SEC}
Persistent=true
[Install]
WantedBy=timers.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now carpeos-agentic.timer
  echo "installed systemd user timer interval=${INTERVAL_SEC}s"
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
