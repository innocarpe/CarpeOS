# <img src="docs/assets/carpeos-mark.png" alt="" width="36" height="36" align="left" />&nbsp; CarpeOS

[English](README.md) · [한국어](README.ko.md)

[![npm](https://img.shields.io/npm/v/@innocarpe/carpeos.svg?style=flat&label=npm&color=cb3837)](https://www.npmjs.com/package/@innocarpe/carpeos)
[![CI](https://github.com/innocarpe/CarpeOS/actions/workflows/ci.yml/badge.svg)](https://github.com/innocarpe/CarpeOS/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/innocarpe/CarpeOS?style=flat)](LICENSE)
[![Node](https://img.shields.io/node/v-lts/@innocarpe/carpeos?style=flat&label=node)](package.json)
[![Website](https://img.shields.io/badge/docs-website-4f7cff?style=flat)](https://innocarpe.github.io/carpeos-website/)

**Capture context. Compound knowledge.**

AI 작업용 **로컬 우선** 개인 지식 OS입니다. 에이전트 세션을 출처와 함께 캡처하고,
남길 가치를 **판정**하며 (`promote` · `hold` · `reject`), 수락된 의미를 CLI / MCP /
Obsidian으로 다시 찾습니다. 모든 대화 덤프를 “메모리”로 쓰지 않습니다.

> **공개 코드. 사적 지식.** 세션과 자격 증명은 내 머신에 둡니다.

<p align="center">
  <img src="docs/assets/readme-hero.jpg" alt="중앙 코어를 둘러싼 지식 노드 네트워크" width="920" />
</p>

## 설치

**Node.js ≥ 22.22** 필요.

```sh
npm install -g @innocarpe/carpeos
carpeos setup plan
carpeos setup run --apply
carpeos setup hooks install --apply
carpeos setup doctor
```

원라이너:

```sh
curl -fsSL https://raw.githubusercontent.com/innocarpe/carpeos/main/scripts/install.sh | bash
```

재현이 필요하면 버전 고정:

```sh
npm install -g @innocarpe/carpeos@5.0.0
```

현재 패키지: **[`@innocarpe/carpeos@5.0.0`](https://www.npmjs.com/package/@innocarpe/carpeos)**
([변경 기록](CHANGELOG.md) · [태그 `v5.0.0`](https://github.com/innocarpe/CarpeOS/releases/tag/v5.0.0)).

## 빠른 시작

```sh
# setup + 호스트 세션(Claude Code / Codex / Grok Build 훅) 이후
carpeos retrieval rebuild --trust-zone tz_local_default
carpeos memory search \
  --query "durable decision" \
  --trust-zone tz_local_default \
  --visible-trust-zone tz_local_default

# held 초안 리뷰 큐
carpeos adjudicate --stats
carpeos adjudicate list-held --limit 50
```

기본 검색은 **promoted / active only**입니다. held는 promote 하거나
`--include-held`를 줄 때까지 기본 경로에 나오지 않습니다.

## 동작 방식

```text
hooks → evidence (암호화 raw + 메타데이터)
      → adjudicate (promote | hold | reject)
      → 승격된 의미
      → retrieval / MCP / CLI / Obsidian projection
```

| 구성 | 역할 |
| --- | --- |
| **Capture** | Claude Code, Codex CLI, Grok Build용 fail-open 훅 |
| **Adjudication** | 정밀 우선 `adj_v3` — 노이즈는 자동 메모리가 아님 |
| **Store** | `~/.carpeos` 아래 로컬 append-only 이벤트 |
| **Retrieval** | 검색, 그래프/하이브리드 회상, context pack |
| **Projections** | MCP, OKF export, 선택적 Obsidian — 재구축 가능, 원본 아님 |
| **Optional** | private sync, opt-in `carpeos v5` draft lane (`canonical_effect: "none"`) |

호스티드 멀티테넌트 SaaS·프로덕션 edge 배포는 이 저장소가 **주장하지 않습니다**.

<p align="center">
  <img src="docs/assets/architecture-flow.svg" alt="캡처·저장 후 MCP, CLI, Obsidian에서 사용" width="920" />
</p>

## 문서

| 주제 | 링크 |
| --- | --- |
| 웹사이트 / 제품 개요 | [carpeos-website](https://innocarpe.github.io/carpeos-website/) |
| 원스톱 설치 | [docs/guides/one-stop-install.md](docs/guides/one-stop-install.md) |
| 캡처 & 훅 | [docs/guides/local-capture.md](docs/guides/local-capture.md) |
| Retrieval CLI | [docs/guides/retrieval.md](docs/guides/retrieval.md) |
| MCP 서버 | [docs/guides/mcp-server.md](docs/guides/mcp-server.md) |
| MCP 도구 계약 | [docs/contracts/mcp-tools-v1.md](docs/contracts/mcp-tools-v1.md) |
| OKF export | [docs/guides/okf-export.md](docs/guides/okf-export.md) |
| Sync (선택) | [docs/guides/cloudflare-sync.md](docs/guides/cloudflare-sync.md) |
| 아키텍처 | [docs/architecture/overview.md](docs/architecture/overview.md) |
| 제품 요구사항 | [docs/PRD.md](docs/PRD.md) |
| 변경 기록 | [CHANGELOG.md](CHANGELOG.md) |
| 버전 / 릴리스 | [docs/maintainers/versioning-and-releases.md](docs/maintainers/versioning-and-releases.md) |

Maintainer DoD·영수증은 [`docs/maintainers/`](docs/maintainers/)
([product-5.0.0](docs/maintainers/product-5.0.0.md),
[product-4.0.0](docs/maintainers/product-4.0.0.md) 등).

## 소스에서 개발

```sh
git clone https://github.com/innocarpe/CarpeOS.git
cd CarpeOS
pnpm install
pnpm build
node scripts/install-local.mjs run --apply
```

검사: `pnpm check` · 스모크: `pnpm smoke:mcp` · `smoke:product` · `smoke:knowledge` · `smoke:dogfood`.

## 기여

이슈와 PR을 환영합니다.

1. 예시는 **synthetic**만 — 실제 프로젝트·트랜스크립트·자격 증명 금지.
2. Conventional Commits와 PR 템플릿을 따릅니다.
3. PR 전에 `pnpm check` (또는 `make preflight`).
4. 이 저장소에서 작업하는 에이전트: [`AGENTS.md`](AGENTS.md).

라벨, CI, 릴리스:

- [GitHub labels](docs/maintainers/github-labels.md)
- [CI policy](docs/maintainers/ci-policy.md)
- [Major release surface](docs/maintainers/major-release-surface.md)
- Skill: [`skills/carpeos-release/SKILL.md`](skills/carpeos-release/SKILL.md)

## 라이선스

[Apache-2.0](LICENSE)
