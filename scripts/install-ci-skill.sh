#!/usr/bin/env bash
# Install the carpeos-ci skill for Claude Code, Codex/agents, Grok Build, and Gajae Code/GJC.
# SSOT remains the git checkout: skills/carpeos-ci/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/skills/carpeos-ci"

if [[ ! -f "${SRC}/SKILL.md" ]]; then
  echo "missing ${SRC}/SKILL.md" >&2
  exit 1
fi
if [[ ! -f "${ROOT}/docs/maintainers/ci-policy.md" ]]; then
  echo "missing ${ROOT}/docs/maintainers/ci-policy.md (policy SSOT)" >&2
  exit 1
fi
GJC_CONFIG_ROOT="${HOME}/${GJC_CONFIG_DIR:-${PI_CONFIG_DIR:-.gjc}}"

link_or_copy() {
  local dest_parent="$1"
  local dest="${dest_parent}/carpeos-ci"
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
rm -rf "${ROOT}/.claude/skills/carpeos-ci" "${ROOT}/.agents/skills/carpeos-ci" "${ROOT}/.codex/skills/carpeos-ci" "${ROOT}/.gjc/skills/carpeos-ci"
ln -sfn "../../skills/carpeos-ci" "${ROOT}/.claude/skills/carpeos-ci"
ln -sfn "../../skills/carpeos-ci" "${ROOT}/.agents/skills/carpeos-ci"
ln -sfn "../../skills/carpeos-ci" "${ROOT}/.codex/skills/carpeos-ci"
ln -sfn "../../skills/carpeos-ci" "${ROOT}/.gjc/skills/carpeos-ci"
echo "linked  ${ROOT}/.claude/skills/carpeos-ci -> ../../skills/carpeos-ci"
echo "linked  ${ROOT}/.agents/skills/carpeos-ci -> ../../skills/carpeos-ci"
echo "linked  ${ROOT}/.codex/skills/carpeos-ci -> ../../skills/carpeos-ci"
echo "linked  ${ROOT}/.gjc/skills/carpeos-ci -> ../../skills/carpeos-ci"
echo ""
echo "carpeos-ci skill installed for Claude Code, Codex CLI, Codex/agents, Grok Build, and Gajae Code/GJC."
echo "Policy SSOT: docs/maintainers/ci-policy.md"
echo "Invoke when editing workflows, CI budgets, smokes/e2e placement, or Product 4 GHA."
