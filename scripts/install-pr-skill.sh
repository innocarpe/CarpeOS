#!/usr/bin/env bash
# Install the carpeos-pr skill for Claude Code, Codex/agents, Grok Build, and Gajae Code/GJC.
# SSOT remains the git checkout: skills/carpeos-pr/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/skills/carpeos-pr"

if [[ ! -f "${SRC}/SKILL.md" ]]; then
  echo "missing ${SRC}/SKILL.md" >&2
  exit 1
fi
GJC_CONFIG_ROOT="${HOME}/${GJC_CONFIG_DIR:-${PI_CONFIG_DIR:-.gjc}}"

link_or_copy() {
  local dest_parent="$1"
  local dest="${dest_parent}/carpeos-pr"
  mkdir -p "${dest_parent}"
  rm -rf "${dest}"
  if ln -s "${SRC}" "${dest}" 2>/dev/null; then
    echo "linked  ${dest} -> ${SRC}"
  else
    mkdir -p "${dest}"
    cp -R "${SRC}/." "${dest}/"
    echo "copied  ${dest}"
  fi
}

link_or_copy "${HOME}/.claude/skills"
link_or_copy "${HOME}/.agents/skills"
link_or_copy "${HOME}/.codex/skills"
link_or_copy "${HOME}/.grok/skills"
link_or_copy "${GJC_CONFIG_ROOT}/agent/skills"
link_or_copy "${GJC_CONFIG_ROOT}/skills"

mkdir -p "${ROOT}/.claude/skills" "${ROOT}/.agents/skills" "${ROOT}/.codex/skills" "${ROOT}/.gjc/skills"
rm -rf "${ROOT}/.claude/skills/carpeos-pr" "${ROOT}/.agents/skills/carpeos-pr" "${ROOT}/.codex/skills/carpeos-pr" "${ROOT}/.gjc/skills/carpeos-pr"
ln -sfn "../../skills/carpeos-pr" "${ROOT}/.claude/skills/carpeos-pr"
ln -sfn "../../skills/carpeos-pr" "${ROOT}/.agents/skills/carpeos-pr"
ln -sfn "../../skills/carpeos-pr" "${ROOT}/.codex/skills/carpeos-pr"
ln -sfn "../../skills/carpeos-pr" "${ROOT}/.gjc/skills/carpeos-pr"
echo "linked  ${ROOT}/.claude/skills/carpeos-pr -> ../../skills/carpeos-pr"
echo "linked  ${ROOT}/.agents/skills/carpeos-pr -> ../../skills/carpeos-pr"
echo "linked  ${ROOT}/.codex/skills/carpeos-pr -> ../../skills/carpeos-pr"
echo "linked  ${ROOT}/.gjc/skills/carpeos-pr -> ../../skills/carpeos-pr"
echo ""
echo "carpeos-pr skill installed for Claude Code, Codex CLI, Codex/agents, Grok Build, and Gajae Code/GJC."
