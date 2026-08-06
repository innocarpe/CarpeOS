#!/usr/bin/env bash
# Install the carpeos-release skill for Claude Code, Codex/agents, Grok Build, and Gajae Code/GJC.
# SSOT remains the git checkout: skills/carpeos-release/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/skills/carpeos-release"

if [[ ! -f "${SRC}/SKILL.md" ]]; then
  echo "missing ${SRC}/SKILL.md" >&2
  exit 1
fi
GJC_CONFIG_ROOT="${HOME}/${GJC_CONFIG_DIR:-${PI_CONFIG_DIR:-.gjc}}"

link_or_copy() {
  local dest_parent="$1"
  local dest="${dest_parent}/carpeos-release"
  mkdir -p "${dest_parent}"
  rm -rf "${dest}"
  # Prefer symlink so repo edits apply everywhere; fall back to copy on failure.
  if ln -s "${SRC}" "${dest}" 2>/dev/null; then
    echo "linked  ${dest} -> ${SRC}"
  else
    mkdir -p "${dest}"
    cp -R "${SRC}/." "${dest}/"
    echo "copied  ${dest}"
  fi
}

# User-global harness skill dirs
link_or_copy "${HOME}/.claude/skills"
link_or_copy "${HOME}/.agents/skills"
link_or_copy "${HOME}/.codex/skills"
link_or_copy "${HOME}/.grok/skills"
link_or_copy "${GJC_CONFIG_ROOT}/agent/skills"
link_or_copy "${GJC_CONFIG_ROOT}/skills"

# In-repo harness paths (relative links so checkouts stay portable)
mkdir -p "${ROOT}/.claude/skills" "${ROOT}/.agents/skills" "${ROOT}/.codex/skills" "${ROOT}/.gjc/skills"
rm -rf "${ROOT}/.claude/skills/carpeos-release" "${ROOT}/.agents/skills/carpeos-release" "${ROOT}/.codex/skills/carpeos-release" "${ROOT}/.gjc/skills/carpeos-release"
ln -sfn "../../skills/carpeos-release" "${ROOT}/.claude/skills/carpeos-release"
ln -sfn "../../skills/carpeos-release" "${ROOT}/.agents/skills/carpeos-release"
ln -sfn "../../skills/carpeos-release" "${ROOT}/.codex/skills/carpeos-release"
ln -sfn "../../skills/carpeos-release" "${ROOT}/.gjc/skills/carpeos-release"
echo "linked  ${ROOT}/.claude/skills/carpeos-release -> ../../skills/carpeos-release"
echo "linked  ${ROOT}/.agents/skills/carpeos-release -> ../../skills/carpeos-release"
echo "linked  ${ROOT}/.codex/skills/carpeos-release -> ../../skills/carpeos-release"
echo "linked  ${ROOT}/.gjc/skills/carpeos-release -> ../../skills/carpeos-release"
echo ""
echo "carpeos-release skill installed for Claude Code, Codex CLI, Codex/agents, Grok Build, and Gajae Code/GJC."
echo "Invoke by asking to release / publish / tag @innocarpe/carpeos, or open skills/carpeos-release/SKILL.md."
