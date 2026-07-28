# CarpeOS

[English](README.md) | [한국어](README.ko.md)

**Capture context. Compound knowledge.**

CarpeOS는 AI-assisted work를 위한 개인 지식 운영체제입니다.

CarpeOS는 여러 AI agent에서 발생하는 작업 맥락을 수집하고,
provenance-aware knowledge로 구조화하며, 여러 기기 사이에서 동기화하고,
사람과 LLM이 모두 탐색할 수 있는 retrieval interface로 노출합니다.

CarpeOS는 현재 초기 단계 프로젝트입니다. 이 저장소는 공개 설계,
specification, 구현, roadmap의 canonical 위치입니다. 이 저장소에는 사용자의
private knowledge store가 들어가지 않습니다.

## 핵심 원칙

**Public implementation. Private knowledge.**

공개 CarpeOS 저장소에는 다음이 들어갑니다.

- ontology와 event specification;
- sync와 retrieval protocol;
- local collector, hook, CLI, MCP, projection code;
- migration, test, synthetic fixture;
- architecture record와 contributor documentation.

사용자의 private CarpeOS instance에는 다음이 들어갑니다.

- 실제 AI session transcript;
- evidence artifact;
- 개인 프로젝트 기록;
- canonical event, claim, decision, supersession, derived fact;
- open loop와 task history;
- device key, zone key, credential, runtime database.

이 저장소에는 실제 사용자 프로젝트명, 실제 session data, credential,
production log, private repository, exported runtime store가 들어가면 안 됩니다.

## 왜 CarpeOS가 필요한가

AI coding agent는 단일 session 안에서는 유용하지만, session이 끝나거나,
기기가 바뀌거나, 다른 provider를 쓰면 맥락이 쉽게 사라집니다. 단순 vector
database는 semantic recall에 도움이 되지만, 보통 더 높은 authority 질문에
답하지 못합니다.

- 이것은 사실인가, 제안인가, rejected hypothesis인가?
- 이 claim을 뒷받침하는 evidence는 무엇인가?
- 언제 observed, recorded, valid 상태였는가?
- supersede되었는가?
- 어떤 agent, device, repository, workflow가 만들었는가?
- 현재 note, vector hit, graph edge가 authoritative한가?

CarpeOS는 memory를 note folder나 vector index 하나가 아니라 event-sourced
knowledge system으로 다룹니다.

## Architecture Model

CarpeOS는 immutable capture와 derived retrieval view를 분리합니다.

```text
AI lifecycle hooks
        |
        v
Local append-only outbox
        |
        v
Canonical event store
        |
        +--> query-time accepted fact view
        +--> Obsidian projection
        +--> vector projection
        +--> graph projection
        +--> search and MCP context packs
```

Append-only `CanonicalEvent` stream은 private knowledge의 source of truth입니다.
Accepted fact는 immutable claim, acceptance decision, supersession에서 query time에
도출됩니다. CarpeOS는 claim record를 mutate해서 accepted 상태로 만들지 않습니다.

Obsidian note, vector index, graph index, dashboard, context pack,
accepted-fact view는 rebuildable projection입니다. 이들은 유용한 interface이지만,
그 자체로 authoritative하지 않습니다.

Runtime data는 physical `TrustZone` boundary로 분리됩니다. Public, local-private,
remote-private, shared, exported data는 하나의 storage 또는 authority model로
합쳐지면 안 됩니다.

## Knowledge Model

Core ontology는 의도적으로 범용적이어야 합니다. 특정 사용자의 private domain을
포함하지 않고도 software development, research, writing, operations, 기타
AI-assisted workflow에서 사용할 수 있어야 합니다.

계획 중인 canonical record type은 다음과 같습니다.

| Type | Purpose |
| --- | --- |
| `CanonicalEvent` | 무엇이 일어났는지, 언제 기록되었는지, 누가 만들었는지, 어떤 trust zone이 소유하는지를 기록하는 append-only envelope. |
| `EvidenceArtifact` | 작업 중 생성되거나 외부에서 참조된 raw material. 크거나 민감한 값은 기본적으로 inline copy하지 않고 external encrypted blob을 가리키는 protected-value reference로 저장해야 합니다. |
| `Observation` | evidence에서 추출되지만 accepted fact로 승격되지 않은 bounded statement. |
| `Claim` | claim 자체를 변경하지 않고 별도의 acceptance decision으로 평가하며 supersession과 연결하는 immutable statement. |
| `AcceptanceDecision` | stated authority, scope, rationale, evidence set 아래에서 claim에 대한 `accepted`, `rejected`, `needs_review`를 기록하는 immutable decision. |
| `Supersession` | 이전 claim 또는 decision을 replace, narrow, invalidate, update하는 immutable record. |

Derived/supporting concept는 다음을 포함할 수 있습니다.

| Type | Purpose |
| --- | --- |
| `Entity` | project, repository, artifact, agent, device, person, concept에 대한 derived 또는 supporting reference. |
| `Relation` | entity, claim, decision, evidence 사이의 derived 또는 supporting typed link. |
| `OpenLoop` | 아직 해결되지 않은 task, risk, question, verification gap을 위한 derived work-management view. |
| `SessionSummary` | 하나의 AI-assisted work session에 대한 projection-friendly compact summary. |

이 모델은 evidence, observation, claim, acceptance, supersession을 분리합니다.
Retrieval이 모든 것을 text로 평면화하지 않고 authority boundary를 유지하기
위해서입니다.

CarpeOS는 bitemporal time을 사용합니다.

- `valid_time`은 modeled domain에서 statement가 언제 true인지를 설명합니다;
- `recorded_time`은 CarpeOS가 event를 언제 기록했는지를 설명합니다.

CarpeOS는 processing lifecycle과 epistemic authority도 분리합니다. Record는
processing lifecycle 측면에서 captured, extracted, reviewed, projected, synced
상태일 수 있습니다. Epistemic authority에는 warrant class인 `unverified`,
`self_reported`, `observed`, `imported`, `derived`, `verified`를 사용합니다.
`accepted`, `rejected`, `needs_review` 값은 `AcceptanceDecision`에만 존재하며,
`superseded`, `erased`, `stale`은 query 또는 projection에서 도출되는 상태입니다.
이 축들은 하나의 mutable status field로 합쳐지면 안 됩니다.

## Retrieval Model

CarpeOS는 hybrid retrieval을 지향합니다.

- project, bitemporal time, lifecycle, authority, trust-zone filter를 위한
  structured query;
- 정확한 용어 검색을 위한 full-text search;
- semantic similarity를 위한 vector search;
- lineage, dependency, supersession path를 위한 graph traversal;
- LLM prompt를 위한 bounded context packing.

목표 LLM-facing interface는 MCP입니다. 계획 중인 tool은 다음과 같습니다.

- `memory_search`
- `memory_get`
- `memory_context_pack`
- `memory_trace`
- `memory_timeline`
- `memory_related`
- `memory_open_loops`
- `memory_capture`

이 tool들은 계획된 API surface이며, 아직 완료된 기능이 아닙니다.

## Agent Integrations

CarpeOS는 provider-neutral하게 설계됩니다. 의도된 integration model은 공통
capture protocol과 agent lifecycle hook adapter입니다.

계획 중인 adapter는 다음과 같습니다.

- Codex CLI hook;
- Grok 기반 coding workflow;
- Claude Code hook;
- 기타 tool을 위한 generic shell hook.

Agent들은 canonical store를 하나의 provider에 묶지 않고, MCP를 통해 같은
knowledge plane을 읽을 수 있어야 합니다.

## Local-First Sync

CarpeOS는 local-first로 동작하도록 설계됩니다.

- 각 device는 local append-only outbox에 기록합니다;
- sync는 event를 private remote instance에 업로드합니다;
- projection은 canonical event에서 다시 생성할 수 있습니다;
- conflict는 generated note를 직접 수정하는 대신 event, decision, supersession,
  erasure-ledger 계층에서 해결합니다.

목표는 public repository를 사용자의 private memory store로 만들지 않으면서도,
여러 기기 사이의 연속성을 제공하는 것입니다.

## Cloudflare Path

계획된 hosted path는 Cloudflare component를 사용할 수 있습니다.

- API와 extraction job을 위한 Workers;
- canonical event metadata를 위한 D1;
- encrypted evidence artifact와 protected-value blob을 위한 R2;
- optional extraction과 embedding을 위한 Workers AI;
- optional semantic search를 위한 Vectorize;
- optional dashboard를 위한 Pages.

Workers AI와 Vectorize는 optional adapter입니다. CarpeOS는 가능한 경우 local
또는 self-hosted alternative도 지원해야 합니다.

개인 MVP에서는 모든 raw hook event를 embedding하지 않고 session summary,
decision, claim, selected evidence chunk 같은 의미 있는 knowledge unit만
embedding한다면 free-tier path가 유용할 것으로 예상합니다.

## MVP Roadmap

이 저장소는 현재 bootstrapping 중입니다. 아래 roadmap은 의도된 작업을 설명하며,
완료된 기능을 의미하지 않습니다.

1. Public project contract 정의.
   - README files
   - governance and security boundaries
   - contribution rules
   - design influence notes

2. Core specification 정의.
   - ontology schema
   - event schema
   - claim, acceptance decision, supersession model
   - temporal and provenance model
   - trust zone and protected-value reference model
   - MCP tool contracts

3. Local runtime 구축.
   - local SQLite store
   - append-only outbox
   - synthetic fixtures
   - projection rebuild tests

4. Agent capture adapter 추가.
   - Codex CLI lifecycle hooks
   - generic hook protocol
   - provider-neutral capture envelope

5. Retrieval 추가.
   - structured search
   - context pack generation
   - MCP server
   - optional vector adapter

6. Projection과 sync 추가.
   - Obsidian projection generator
   - Cloudflare sync adapter
   - optional dashboard

## Repository Boundary

Synthetic example만 사용합니다.

허용되는 예시:

```text
Example Alpha
Example Repository
Example Decision
Synthetic Incident
```

허용되지 않는 예시:

```text
real project names
real repository URLs
real session transcripts
real commit hashes from private work
real production logs
credentials or tokens
local user paths
```

Private use 중 발견한 pattern은 public ontology rule, test, documentation으로
일반화할 수 있습니다. 그 근거가 된 private fact는 사용자의 private CarpeOS
instance 안에 남겨야 합니다.

## Design Influences

CarpeOS는 [obsidian-mind](https://github.com/breferrari/obsidian-mind)에서
일부 영감을 받았습니다. 특히 AI agent를 위한 durable memory, lifecycle-hook
integration, agent가 접근할 수 있는 interface를 통한 semantic retrieval이라는
vision에서 영향을 받았습니다.

CarpeOS는 다른 architecture model을 가진 독립적인 구현입니다.

- Markdown vault를 authority로 삼지 않고 append-only canonical event log를
  사용합니다;
- CanonicalEvent, EvidenceArtifact, Observation, Claim, AcceptanceDecision,
  Supersession semantics를 명시합니다;
- temporal, authority, provenance-aware ontology를 사용합니다;
- physical trust-zone isolation과 protected-value reference를 사용합니다;
- local-first multi-device synchronization을 지향합니다;
- Obsidian, vector, graph, context-pack projection을 rebuildable하게 다룹니다;
- Codex, Grok, Claude, 기타 MCP-capable agent를 위한 provider-neutral
  integration을 지향합니다.

별도로 명시하지 않는 한 CarpeOS는 `obsidian-mind`의 source code를 포함하지
않습니다. 재사용되는 third-party component는 원래의 copyright와 license notice를
유지해야 합니다.

## Project Status

CarpeOS는 pre-MVP 단계입니다. 첫 usable runtime release 전에 repository를
정리하는 중입니다.

계획된 command, API, adapter, deployment path는 이 저장소에서 구현, 테스트,
문서화되기 전까지 stable한 것으로 간주하지 마십시오.
