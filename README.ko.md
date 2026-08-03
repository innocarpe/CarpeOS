# <img src="docs/assets/carpeos-mark.png" alt="" width="36" height="36" align="left" />&nbsp; CarpeOS

[English](README.md) · [한국어](README.ko.md)

[![npm](https://img.shields.io/npm/v/@innocarpe/carpeos.svg?style=flat&label=npm&color=cb3837)](https://www.npmjs.com/package/@innocarpe/carpeos)
[![CI](https://github.com/innocarpe/CarpeOS/actions/workflows/ci.yml/badge.svg)](https://github.com/innocarpe/CarpeOS/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/innocarpe/CarpeOS?style=flat)](LICENSE)
[![Node](https://img.shields.io/node/v-lts/@innocarpe/carpeos?style=flat&label=node)](package.json)
[![GitHub release](https://img.shields.io/github/v/release/innocarpe/CarpeOS?style=flat&label=release)](https://github.com/innocarpe/CarpeOS/releases/latest)
[![Website](https://img.shields.io/badge/docs-website-4f7cff?style=flat)](https://innocarpe.github.io/carpeos-website/)

**Capture context. Compound knowledge.**

CarpeOS는 AI 보조 작업을 위한 개인 지식 OS입니다. 에이전트 세션을 출처와 함께
캡처하고, **무엇이 기억할 가치가 있는지 판정**하며 (`promote` | `hold` | `reject`),
수락된 결정을 검색 가능하게 유지하고, MCP·CLI·Obsidian으로 사람과 에이전트가
나중에 다시 꺼내 쓰게 합니다. 전부 로컬 우선입니다.

세션 덤프 전부를 “메모리”로 취급하지 않습니다. 각 조각이 어디서 왔는지 흔적을
남기되, **승격된 의미 단위**가 기본 검색 대상입니다.

**최신 릴리스:** [`@innocarpe/carpeos@3.1.0`](https://www.npmjs.com/package/@innocarpe/carpeos)
([변경 기록](CHANGELOG.md) · [v3.1.0 릴리스](https://github.com/innocarpe/CarpeOS/releases/tag/v3.1.0) ·
[product 3.1 DoD](docs/maintainers/product-3.1.0.md)).

<p align="center">
  <img src="docs/assets/readme-hero.jpg" alt="지식 노드가 중심으로 모이는 네트워크 이미지" width="920" />
</p>

<p align="center">
  <img src="docs/assets/architecture-flow.svg" alt="Capture, store, sync 후 MCP·CLI·Obsidian 사용" width="920" />
</p>

## 웹사이트

**[CarpeOS 웹사이트](https://innocarpe.github.io/carpeos-website/)**에서 제품
개요, 시스템 모델, 설치 경로, 공개 문서 안내를 확인할 수 있습니다.

---

## 왜 만들었나

에이전트랑 한참 작업하다 보면, 결정이 하나 남거나, 다시 밟기 싫은 실패
경로가 남거나, 다음에도 쓸 메모가 생깁니다. 그런데 그게 채팅 기록, 터미널
스크롤, 노트 파일에 제각각 흩어져 있고, 며칠 뒤 새 세션을 열면 그 맥락은
거의 안 넘어갑니다.

CarpeOS는 그 맥락을 내가 통제하는 한곳에 모아 두되, “우리가 X로 정했다”와
“모델이 X를 한 번 말했다”를 같은 취급하지 않게 구조를 둔 시도입니다.

| 자주 겪는 일 | 이쪽 접근 |
| --- | --- |
| 채팅 기록이 날아가거나 믿기 어렵다 | 출처가 남는 append-only 이벤트 |
| 세션 노이즈가 “메모리”를 오염시킨다 | 캡처 후 판정; 기본 검색은 **promote만** |
| “메모리”가 사실상 임베딩 뭉치 | claim / 수락 / supersession을 다른 레코드로 둠 |
| 도구마다 기억이 따로 논다 | 공통 capture + MCP 검색 (특정 벤더 종속 아님) |
| 생성된 노트가 곧 원본이 된다 | 노트·인덱스는 다시 만들 수 있는 projection |
| 기기 두 대면 연속성이 지저분하다 | 로컬 우선, 필요하면 private sync |

> **코드는 공개. 지식은 비공개.**  
> 이 저장소에는 설계, 스펙, 구현이 있습니다. 실제 세션·프로젝트·자격 증명은
> 넣지 않습니다.

---

## 이런 사람에게 맞음

- Codex, Claude Code, Grok Build처럼 에이전트를 여러 개 쓰는데, 도구마다
  기억을 따로 관리하기 싫을 때
- 지난주 결정이 옛 채팅 속에만 있지 않고, 다시 꺼내 쓸 수 있어야 할 때
- 검색 결과에 draft / 거절 / 수락이 구분돼 보여야 할 때
- 데이터는 기본이 로컬이고, sync는 직접 돌리고 싶을 때
- 스키마·테스트가 있는 쪽이, 잘 모르는 “메모리 제품”보다 나을 때

아직 소비자용으로 다듬인 앱이 아닙니다. 호스티드 SaaS도 아니고, 에디터
대체재도 아닙니다. 에이전트 워크플로를 이미 쓰는 사람용 기반 코드에 가깝습니다.

---

## 구성

### 쓰던 에이전트에서 캡처

Codex, Claude Code, Grok Build의 일부 lifecycle 이벤트를 공통 capture 형태로
넘깁니다. raw payload는 암호화 저장소에, 이벤트 로그에는 메타데이터·참조를
둡니다. 호스트 훅은 **fail-open·빠른 경로**를 유지합니다.

### 기억하기 전에 판정

캡처 뒤 precision-first 규칙 판정기(`adj_v2`)가 disposition을 정합니다.

| Disposition | 의미 단위 | 기본 검색 |
| --- | --- | --- |
| **promote** | active Observation | 포함 |
| **hold** | draft Observation (리뷰 큐) | 제외 (`--include-held` / `include_held` 시에만) |
| **reject** | disposition만 (증거는 남을 수 있음) | 제외 |

hold 리뷰(`carpeos adjudicate list-held|promote-held|reject-held`), policy
history, 새 policy version 재판정이 가능합니다. 판정은 **`AcceptanceDecision`을
자동 생성하지 않습니다**.

### 상태를 뭉개지 않는 모델

Evidence는 claim이 아닙니다. claim이 있다고 해서 바로 “맞다”가 아닙니다.
수락과 supersession은 별도 기록입니다. 검색 시 확정·제안·교체를 한 덩어리
벡터 텍스트로 뭉개지 않습니다.

```mermaid
flowchart LR
  E[EvidenceArtifact] --> J[Adjudicate adj_v2]
  J -->|promote| O[Observation active]
  J -->|hold| H[Observation draft]
  J -->|reject| R[Evidence only]
  O --> C[Claim]
  C --> A[AcceptanceDecision]
  C --> S[Supersession]
  A --> F[Accepted fact<br/>query 시점에 계산]
  S --> F
```

### 사람용 / 에이전트용 인터페이스

- **CLI** — `capture-hook`, `extract`, **`adjudicate`**, `retrieval rebuild`,
  `memory search|get|context-pack` (기본 promoted only; `--include-held` 선택),
  `sync status|push|pull|once|cycle`
- **MCP (stdio)** — 로컬 도구 8개 (`memory_search`, `memory_get`,
  `memory_context_pack`, `memory_trace`, `memory_timeline`, `memory_related`,
  `memory_capture`, `memory_propose_claim`)
- **Obsidian projection** — 로컬 스토어에서 Markdown 생성 (원본 아님, projection)
- **OKF v0.2 export projection** — `carpeos okf export|rebuild`가 신뢰 영역 범위를
  명시한 portable bundle을 만듭니다. 기본값은 promoted/active이며 canonical storage나
  import 경로가 아닙니다 ([가이드](docs/guides/okf-export.md)).

### 로컬 우선, sync는 선택

기기는 로컬 outbox에 씁니다. 여러 기기가 필요하면 Cloudflare Worker/D1/R2용
코드를 직접 띄울 수 있고, 운영용 **bounded** `carpeos sync cycle`이 있습니다.
projection은 이벤트 로그에서 언제든 다시 만들 수 있습니다.

```mermaid
flowchart TB
  subgraph devices [내 기기]
    H1[Agent hooks]
    CLI[carpeos CLI]
    MCP[MCP stdio server]
    OBS[Obsidian projection]
  end

  subgraph local [로컬 런타임]
    OUT[암호화 outbox + local store]
    RET[검색 + recheck]
  end

  subgraph private [선택적 private sync]
    W[Cloudflare Worker]
    D1[(D1 metadata)]
    R2[(R2 암호화 blob)]
  end

  H1 --> OUT
  CLI --> OUT
  OUT --> RET
  RET --> MCP
  RET --> OBS
  OUT <--> W
  W --> D1
  W --> R2
```

---

## 전체 흐름

```mermaid
flowchart LR
  A[Agent hooks] --> B[Local capture]
  B --> J[Adjudicate]
  J --> C[Event store + dispositions]
  C --> D[Promoted meaning first]
  C --> E[Projections]
  E --> F[MCP / CLI / Obsidian]
  D --> F
```

알아 둘 규칙:

1. 이벤트 로그와 disposition은 append-only입니다 (policy version별).
2. 기본 검색은 **promoted/active** 의미 단위입니다. 모든 세션이 메모리가 아닙니다.
3. “accepted”는 query 시점에 계산합니다. claim 레코드를 덮어쓰지 않습니다.
4. 민감한 plaintext는 이벤트 body 밖에 둡니다.
4. Trust zone은 진짜 격리 경계입니다. 장식용 태그가 아닙니다.
5. 노트·벡터·context pack은 지우고 다시 만들어도 됩니다. canonical store가
   아닙니다.

더 자세한 내용:
[Architecture overview](docs/architecture/overview.md),
[Memory capacity](docs/architecture/memory-capacity.md),
[ADR 0009](docs/adr/0009-memory-capacity-model.md),
[ADRs](docs/adr/),
[spec/v1](spec/v1/).

### 메모리 용량 (전체 vs 활성)

CarpeOS는 **얼마나 쌓아 두는지**와 **지금 에이전트가 얼마나 불러오는지**를
나눕니다.

| 축 | 의미 | 위치 |
| --- | --- | --- |
| **Total capacity** | trust zone 아래 visible 이벤트 + protected blob | L1 store |
| **Active capacity** | budget·재검사 후 pack/search에 실리는 양 | L2 working memory |
| **Procedural memory** | thinking/tool 트레이스 (자동 수락 없음) | L3 |
| **Product projections** | 다시 만들 수 있는 노트·pack·open loop·dashboard | L4 |

Context pack은 기본 16개 **expert-slot**으로 sparse 하게 채우고, accepted fact를
draft보다 앞에 두는 cache-friendly 순서를 씁니다.
[메모리 용량 아키텍처](docs/architecture/memory-capacity.md),
[capacity 마스터 플랜](docs/plans/k3-memory-capacity-master-plan.md)을 보세요.
교차 저장소 partition과 worktree facet을 포함한 retrieval-first 그래프/하이브리드
회상은 3.0에 출시되었습니다. hosted graph adapter와 그 밖의 로드맵 작업은 아직
계획 상태입니다. [product 3.0 DoD](docs/maintainers/product-3.0.0.md) 및
[GraphRAG 로드맵](docs/plans/graphrag-roadmap.md)을 보세요.

---

## 설치

**Node.js ≥ 22.22** 필요.

### 사용자

```sh
# npm (권장)
npm install -g @innocarpe/carpeos
carpeos setup plan              # 경로·액션만 확인 (변경 없음)
carpeos setup run --apply       # 기본값으로 적용

# 또는 curl (동일 패키지 설치 후 setup run --apply)
curl -fsSL https://raw.githubusercontent.com/innocarpe/carpeos/main/scripts/install.sh | bash
```

`carpeos setup` 은 플래그 나열이 아니라 **명령 + 옵션** 인터페이스입니다.
기본 런타임은 `~/.carpeos`, wrapper는 `~/.local/bin` 이며, PATH에 있으면
**Claude Code / Codex CLI / Grok Build** 에 로컬 MCP를 등록합니다.

```sh
carpeos setup --help            # 전체 파라미터
carpeos setup plan              # 해석된 plan만
carpeos setup run --apply       # 적용 (home, wrapper, MCP)
carpeos setup hooks install --apply   # 캡처 훅 (머지 안전; 제품 경로)
carpeos setup doctor            # 설치 + 훅 + 스토어 신호 검증
carpeos setup show              # config.json 출력
```

주요 옵션: `--home`, `--bin-dir`, `--workspace-root`, `--trust-zone`,
`--register-mcp auto|none|claude,codex,grok`, `--register-hooks auto|none|…`.
`--apply` 없이는 기계를 바꾸지 않습니다.

재현이 중요하면 버전 고정: `npm i -g @innocarpe/carpeos@3.1.0`.
변경 기록: [CHANGELOG.md](CHANGELOG.md).
제품 마일스톤: [1.0 DoD](docs/maintainers/product-1.0.0.md) (파이프라인) ·
[2.0 DoD](docs/maintainers/product-2.0.0.md) (판정) ·
[3.0 DoD](docs/maintainers/product-3.0.0.md) (retrieval-first 그래프) ·
[3.1 DoD](docs/maintainers/product-3.1.0.md) (OKF v0.2 export).

### 개발자 (git checkout)

```sh
git clone https://github.com/innocarpe/carpeos.git && cd carpeos
node scripts/install-local.mjs plan
node scripts/install-local.mjs run --apply   # 빌드, wrapper, MCP 등록
node scripts/install-local.mjs hooks install --apply
export PATH="$HOME/.local/bin:$PATH"
node scripts/install-local.mjs doctor
```

글로벌 설치 없이 monorepo만 쓸 때: `pnpm install && pnpm build` 후
`node apps/carpeos-cli/dist/index.js …`
([local capture](docs/guides/local-capture.md)).

### 제품 경로: 설치 → 세션 → 판정 → 검색

```sh
# 1) 런타임 + MCP
carpeos setup run --apply
# 2) 캡처 훅 (사용자 훅을 지우지 않음)
carpeos setup hooks install --apply
# 3) doctor (훅, 스토어, 판정 health, 기본 검색=promoted only)
carpeos setup doctor
# 4) 호스트 세션(또는 capture-hook) 후 rebuild + promote 의미 검색
carpeos retrieval rebuild --trust-zone tz_local_default
carpeos memory search \
  --query "durable decision" \
  --trust-zone tz_local_default \
  --visible-trust-zone tz_local_default
# 선택: held/draft 포함
# carpeos memory search --include-held --query "…" …

# hold 리뷰 큐
carpeos adjudicate --stats
carpeos adjudicate list-held --limit 50
# carpeos adjudicate promote-held --event-id evt_…
# carpeos adjudicate reject-held --event-id evt_…
```

`carpeos setup doctor` 는 훅 설치, 최근 `EvidenceArtifact`, Observation/Claim 개수,
**판정 policy_version + promote/hold/reject 카운트**, **기본 검색이 promoted/active
only** 임을 보고합니다 (빈 스토어는 warning).

자동 게이트:

| 게이트 | 증명 내용 |
| --- | --- |
| `pnpm smoke:product` | 1.0 파이프라인 루프 |
| `pnpm smoke:knowledge` | 2.0 promote vs noise reject |
| `pnpm smoke:dogfood` | multi-hook 공개-safe 노이즈 시나리오 |
| `pnpm smoke:mcp` | MCP 도구 surface |

수동/고급 템플릿: [`adapters/`](adapters/). 문서:
[one-stop install](docs/guides/one-stop-install.md) ·
[MCP](docs/guides/mcp-server.md).

### 에이전트가 이 저장소를 설치할 때

설치는 **idempotent** 하게, private 데이터는 **git 밖**에 둡니다.

1. 우선 `npm i -g @innocarpe/carpeos` + `carpeos setup plan` 후
   `carpeos setup run --apply` (또는 `install.sh`).
2. 캡처 훅: `carpeos setup hooks install --apply`.
3. 소스 작업이면 checkout에서 `node scripts/install-local.mjs run --apply`.
4. `~/.carpeos`, credential, 실제 세션 데이터를 커밋하지 말 것.
5. 설치 경로를 새로 만들지 말 것. setup이 MCP(및 선택적 훅)를 등록함.
6. 릴리스는 SemVer + `vX.Y.Z` 태그만 —
   [versioning](docs/maintainers/versioning-and-releases.md),
   스킬 `skills/carpeos-release/SKILL.md`
   (`./scripts/install-release-skill.sh`).
   SemVer를 따르고, release skill 밖의 태그를 만들지 말 것.

| 가이드 | 링크 |
| --- | --- |
| 설치 (전체 경로) | [docs/guides/one-stop-install.md](docs/guides/one-stop-install.md) |
| Capture & hooks | [docs/guides/local-capture.md](docs/guides/local-capture.md) |
| Retrieval / context-pack CLI | [docs/guides/retrieval.md](docs/guides/retrieval.md) |
| MCP | [docs/guides/mcp-server.md](docs/guides/mcp-server.md) |
| Cloudflare / sync | [docs/guides/cloudflare-sync.md](docs/guides/cloudflare-sync.md) |
| OKF v0.2 export projection | [docs/guides/okf-export.md](docs/guides/okf-export.md) |
| Smokes | `pnpm smoke:mcp` · `smoke:product` · `smoke:knowledge` · `smoke:dogfood` |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| Product 1.0 DoD (파이프라인) | [docs/maintainers/product-1.0.0.md](docs/maintainers/product-1.0.0.md) |
| Product 2.0 DoD (판정) | [docs/maintainers/product-2.0.0.md](docs/maintainers/product-2.0.0.md) |
| Product 3.0 DoD (retrieval-first 그래프) | [docs/maintainers/product-3.0.0.md](docs/maintainers/product-3.0.0.md) |
| Product 3.1 DoD (OKF v0.2 export) | [docs/maintainers/product-3.1.0.md](docs/maintainers/product-3.1.0.md) |
| 버전·릴리스 | [docs/maintainers/versioning-and-releases.md](docs/maintainers/versioning-and-releases.md) |
| Sync / multi-Mac | [docs/guides/cross-mac-bootstrap-recovery.md](docs/guides/cross-mac-bootstrap-recovery.md) |
| Memory capacity plan | [docs/plans/k3-memory-capacity-master-plan.md](docs/plans/k3-memory-capacity-master-plan.md) |

---

## 제품 라인 (1.0 → 2.0 → 3.0 → 3.1)

| 패키지 / 제품 | 의미 | 상태 |
| --- | --- | --- |
| **1.0.0** | 로컬 **파이프라인 + 계약** freeze | **출시** — 인프라 기준선. “완성된 지식 OS” 아님 |
| **2.0.0** | **판정된 의미**가 기본 제품 계약 (`adj_v1`, promoted-only 검색, held 리뷰, doctor, smoke) | **출시** (npm / `v2.0.0`) — 운영 가능한 MVP. 인간 수준 판단 아님 |
| **3.0.0** | 교차 저장소 partition과 worktree facet을 갖춘 retrieval-first 그래프/하이브리드 회상 | **출시** (npm / `v3.0.0`) |
| **3.1.0** | 추가된 **OKF v0.2 export projection** | **출시** — `@innocarpe/carpeos@3.1.0` / `v3.1.0`; export만 지원하고 import 경로는 아님 |

남은 경계도 있습니다. golden/dogfood fixture는 synthetic이고, 세션 de-noise에는
한계가 있으며, 판정 경로의 **Claim** draft는 보류되어 있고, 구 policy active 단위는
optional cleanup이 필요할 수 있습니다. hosted graph adapter와 그 밖의 로드맵 작업은
아직 출시되지 않았습니다. 상세:
[product 2.0 residual](docs/maintainers/product-2.0.0.md) ·
[product 3.0 DoD](docs/maintainers/product-3.0.0.md) ·
[product 3.1 DoD](docs/maintainers/product-3.1.0.md).

용량·팩 경제·장기 구조는
[memory capacity master plan](docs/plans/k3-memory-capacity-master-plan.md) 아래로
이어지며, 이는 출시된 3.0 retrieval 제품의 상태를 바꾸지 않습니다.

---

## 지금 구현된 것

**공개 릴리스:** [`@innocarpe/carpeos@3.1.0`](https://www.npmjs.com/package/@innocarpe/carpeos)
([GitHub Release](https://github.com/innocarpe/CarpeOS/releases/tag/v3.1.0) ·
[CHANGELOG](CHANGELOG.md#310---2026-08-01) ·
[product 3.1 DoD](docs/maintainers/product-3.1.0.md)).
패키지 공개와 로컬 설치는 호스티드 배포를 뜻하지 않습니다.

기본 로컬 루프 (CI 게이트):

```text
hooks → 암호화 증거 → adjudicate (promote|hold|reject)
  → 승격된 의미 → retrieval-first 그래프/하이브리드 회상 → MCP / CLI
  (+ 로컬 OKF v0.2 export, 선택 private sync, Obsidian projection)
```

| 영역 | 상태 |
| --- | --- |
| Specs, ontology, ADRs | 있음 ([ADR 0012](docs/adr/0012-knowledge-adjudication.md) 포함) |
| Local capture + outbox | 출시 |
| Knowledge adjudication (`adj_v2`) | 출시 — disposition, held 리뷰, policy history |
| 기본 retrieval | **promoted/active only**; held는 opt-in |
| Doctor 판정 health | 출시 |
| Sync Worker/client + bounded `sync cycle` | 코드 + 로컬 테스트. production edge 주장 없음 |
| MCP stdio (도구 8개) | 로컬만 |
| Expert-slot context pack | CLI + MCP (로컬) |
| Retrieval-first 그래프/하이브리드 회상 | **출시** — indexed graph traversal, 교차 저장소 partition, worktree facet |
| Hosted graph adapter / service | 계획됨; 출시·배포되지 않음 |
| OKF v0.2 export projection | **3.1에 출시** — 로컬 export만, import 경로 없음 |
| `carpeos setup` / one-stop install | npm `@innocarpe/carpeos` |
| OpenLoop / dashboard 라이브러리 | 라이브러리+테스트. 제품 UI 아님 |
| Obsidian projection | 로컬만 |
| Hosted embeddings / multi-tenant SaaS | 이 저장소 목표 아님 |
| **3.0.0 product freeze** | **출시** — `v3.0.0` |
| **3.1.0 public release** | **출시** — `@innocarpe/carpeos@3.1.0` / `v3.1.0` |

**NOT DEPLOYED:** hosted Worker, D1/R2 production, hosted graph adapter/service,
private vault, hosted MCP 는 이 저장소가 증명하지 않습니다. npm 게시는 SemVer 태그 + CI
([versioning](docs/maintainers/versioning-and-releases.md)).

어댑터 설치, 실제 Cloudflare 운영, hosted MCP, 인간 수준 판정 품질을 “완료”로
보지 마세요.

---

## 저장소 경계

공개되는 건 구현뿐입니다. 런타임 지식은 비공개입니다.

| 여기 OK | 여기 금지 |
| --- | --- |
| Synthetic fixture (`Example Alpha` 등) | 실제 프로젝트명, private URL |
| 프로토콜 예시 | 실제 세션 transcript |
| 테스트·스키마 | credential, token, production log |
| 기여자 문서 | 런타임 DB dump, 개인 경로 |

---

## 디자인 영향

[obsidian-mind](https://github.com/breferrari/obsidian-mind)와 겹치는 문제의식
(에이전트 메모리, hook, 에이전트용 검색)은 있습니다. 구현은 별개입니다.
Markdown vault를 원본으로 두지 않고 append-only 이벤트를 쓰고,
claim/수락/supersession·trust zone·protected value·벤더 중립 MCP를 전제로
잡았습니다.

---

## 기여

[CONTRIBUTING.md](CONTRIBUTING.md), [GOVERNANCE.md](GOVERNANCE.md),
[AGENTS.md](AGENTS.md) 참고.

```sh
pnpm check   # format, lint, build, typecheck, test, public-boundary
```

공개 패키지 릴리스는 하네스 공통 스킬을 따릅니다:

```sh
./scripts/install-release-skill.sh   # Claude / Codex / Grok 스킬 링크
# 이후 release / tag / npm — skills/carpeos-release/SKILL.md
```

---

## 라이선스

[Apache License 2.0](LICENSE)
