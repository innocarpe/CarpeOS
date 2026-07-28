# CarpeOS

[English](README.md) | [한국어](README.ko.md)

**Capture context. Compound knowledge.**

CarpeOS는 AI-assisted work를 위한 개인 지식 운영체제입니다.

CarpeOS는 여러 AI agent에서 발생하는 작업 맥락을 수집하고,
provenance-aware knowledge로 구조화하며, 여러 기기 사이에서 동기화하고, 사람과
LLM이 모두 탐색할 수 있는 retrieval interface로 노출하도록 설계됩니다. 현재 G006
구현 범위는 local capture, durable outbox storage, Cloudflare Worker/D1/R2 sync
backend와 client, 그리고 local rebuildable retrieval projection과 CLI
search/get command입니다. 이 경로들은 synthetic data로 local test되어 있습니다.
Live Cloudflare deployment를 완료했다고 주장하지 않습니다. MCP, GraphRAG,
Obsidian projection, hosted embedding job, production semantic retrieval quality는
계획된 milestone이며 아직 active feature가 아닙니다.

이 저장소는 공개 설계, specification, 구현, roadmap의 canonical 위치입니다. 이
저장소에는 사용자의 private knowledge store가 들어가지 않습니다.

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

## 현재 구현

G004는 local capture runtime을 추가합니다.

- provider-neutral raw `EvidenceArtifact` capture;
- Codex, Claude Code, Grok Build hook template example;
- raw hook JSON을 위한 AES-256-GCM protected-value store;
- SQLite database 외부에 저장되는 local key material;
- Node 22.22+ `node:sqlite` 기반 local store;
- append-only `capture_requests`, `canonical_events` table;
- `pending`, `leased`, `delivered` 상태를 가진 durable idempotent metadata
  outbox;
- explicit project ID, sanitized Git remote hash, device-local workspace hash에서
  파생되는 project identity;
- local init, project identity, hook capture, outbox inspection을 위한 CLI surface.

Local store는 raw provider payload를 encrypted protected value로 기록하고,
canonical event에는 metadata와 protected-value reference만 저장합니다. 하나의
`protected_value_id`가 canonical reference, encrypted local row, leased outbox
metadata, 향후 erasure target을 연결합니다. Local capture는 device ordering을
위한 `local_sequence`를 부여합니다. Canonical `zone_sequence`는 부여하지 않으며,
이는 G005 server-side 책임입니다.

G005는 첫 sync boundary를 추가합니다.

- authenticated `sync push`, `sync pull`, `sync once`, `sync status` CLI command;
- metadata acceptance 전에 수행되는 encrypted protected-value upload/download;
- idempotency, replay, conflict, per-zone sequence, pull cursor state를 위한 D1;
- encrypted protected-value ciphertext storage를 위한 R2;
- MacBook/Mac mini sharing을 위한 out-of-band trust-zone sync key enrollment;
- Worker, client, local store, CLI에 대한 synthetic local integration test.

Sync backend는 deployable code와 local test infrastructure로 구현되어 있습니다.
이 저장소는 production Cloudflare Worker, D1 database, R2 bucket이 실제로
provision되었다고 주장하지 않습니다.

G006은 첫 local retrieval boundary를 추가합니다.

- canonical event와 erasure record에서 파생되는 rebuildable retrieval chunk;
- raw hook JSON이 아니라 claim, observation, decision, selected evidence metadata
  같은 meaningful-unit chunking;
- FTS, structured metadata, recency, locally stored vector candidate path;
- trust-zone visibility, lifecycle, authority, supersession, erasure,
  projection freshness에 대한 모든 result의 canonical recheck;
- test와 local smoke check를 위한 deterministic local development embedding;
- `retrieval rebuild`, `retrieval embed`, `memory search`, `memory get` CLI
  command.

Deterministic embedding provider는 synthetic development-only provider입니다.
Workers AI와 Vectorize binding은 adapter boundary로 코드에 있지만, 이 저장소는
live Workers AI/Vectorize resource, hosted embedding execution, production
semantic quality를 주장하지 않습니다.

## 빠른 시작

Prerequisite:

- Node.js 22.22 이상;
- pnpm 11.16 이상.

Workspace를 build하고 검증합니다.

```sh
pnpm install
pnpm build
```

Local runtime을 초기화합니다.

```sh
node apps/carpeos-cli/dist/index.js init
```

현재 project identity를 확인합니다.

```sh
node apps/carpeos-cli/dist/index.js project identify
```

Synthetic Codex hook payload 하나를 capture합니다.

```sh
node apps/carpeos-cli/dist/index.js capture-hook --provider codex --input argv \
  '{"hook_event_name":"SessionEnd","session_id":"session_synthetic","timestamp":"2026-01-01T00:00:00Z","message":"synthetic capture"}'
```

Local outbox를 확인합니다.

```sh
node apps/carpeos-cli/dist/index.js outbox status
```

Secret을 노출하지 않고 sync readiness를 확인합니다.

```sh
node apps/carpeos-cli/dist/index.js sync status
```

Private Worker URL과 local `0600` credential/trust-zone sync key file을 설정한
뒤 bounded sync cycle을 한 번 실행합니다.

```sh
node apps/carpeos-cli/dist/index.js sync once \
  --url https://carpeos-sync.example.workers.dev \
  --credential-file "$HOME/.carpeos/sync-credential" \
  --sync-key-file "$HOME/.carpeos/trust-zone-sync.key"
```

`adapters/`의 provider template은 `PATH`에 `carpeos` binary가 있다고 가정합니다.
이 저장소에서는 compiled CLI entrypoint인 `apps/carpeos-cli/dist/index.js`를 통해
command behavior를 테스트합니다. Package installation과 binary distribution은
별도의 packaging work입니다.

전체 command surface와 hook template note는
[Local Capture Guide](docs/guides/local-capture.md)를 참고하십시오. Local Worker,
D1, R2, secret file, MacBook/Mac mini sync setup은
[Cloudflare Sync Guide](docs/guides/cloudflare-sync.md)를 참고하십시오. Local
projection rebuild, development embedding, search/get command는
[Retrieval Guide](docs/guides/retrieval.md)를 참고하십시오.

## Architecture Model

CarpeOS는 immutable capture와 derived retrieval view를 분리합니다.

```text
AI lifecycle hooks
        |
        v
Local append-only outbox
        |
        v
Private sync service
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
Accepted fact는 immutable claim, acceptance decision, supersession에서 query
time에 도출됩니다. CarpeOS는 claim record를 mutate해서 accepted 상태로 만들지
않습니다.

Obsidian note, vector index, graph index, dashboard, context pack,
accepted-fact view는 rebuildable projection입니다. 이들은 유용한 interface이지만,
그 자체로 authoritative하지 않습니다.

Runtime data는 physical `TrustZone` boundary로 분리됩니다. Public,
local-private, remote-private, shared, exported data는 하나의 storage 또는
authority model로 합쳐지면 안 됩니다.

## Knowledge Model

Core ontology는 의도적으로 범용적이어야 합니다. 특정 사용자의 private domain을
포함하지 않고도 software development, research, writing, operations, 기타
AI-assisted workflow에서 사용할 수 있어야 합니다.

Canonical record type은 다음과 같습니다.

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

CarpeOS에는 local hybrid retrieval MVP가 구현되어 있습니다.

- project, bitemporal time, lifecycle, authority, trust-zone filter를 위한
  structured query;
- 정확한 용어 검색을 위한 full-text search;
- stored embedding을 위한 vector candidate support;
- provenance, supersession, erasure, projection freshness를 위한 lineage-aware
  result metadata;
- chunk를 visible하게 반환하기 전 수행되는 canonical result recheck.

Vector search는 candidate-retrieval mechanism이며 authority model이 아닙니다.
모든 result는 canonical source record로 추적 가능해야 하며, vector hit가 claim을
accepted fact로 만들지 않습니다.

현재 CLI command는 다음과 같습니다.

- `carpeos retrieval rebuild`
- `carpeos retrieval embed --provider deterministic-local-dev`
- `carpeos memory search --query ... --visible-trust-zone ...`
- `carpeos memory get --chunk-id ... --visible-trust-zone ...`

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

CarpeOS는 provider-neutral하게 설계됩니다. 현재 template은 selected Codex,
Claude Code, Grok Build lifecycle event를 common capture envelope로 normalize합니다.

References:

- Codex hooks: <https://learn.chatgpt.com/docs/hooks>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Grok Build hooks: <https://docs.x.ai/build/features/hooks>

Agent들은 canonical store를 하나의 provider에 묶지 않고, MCP를 통해 같은
knowledge plane을 읽을 수 있어야 합니다. 이 read path는 아직 구현되지 않았습니다.

## Local-First Sync

CarpeOS는 local-first로 동작하도록 설계됩니다.

- 각 device는 local append-only outbox에 기록합니다;
- sync는 event를 private remote instance에 업로드합니다;
- projection은 canonical event에서 다시 생성할 수 있습니다;
- conflict는 generated note를 직접 수정하는 대신 event, decision, supersession,
  erasure-ledger 계층에서 해결합니다.

G005는 synthetic local integration test와 함께 첫 remote sync backend와 client
path를 구현합니다. Cross-Mac sharing은 private operator가 Cloudflare D1/R2/Worker
resource를 provision하고, authorization을 seed하고, 각 Mac을 같은 out-of-band
trust-zone sync key로 enroll한 뒤에만 실제로 동작합니다.

## Cloudflare Path

G005 sync backend의 hosted path는 Cloudflare component를 사용합니다.

- sync API를 위한 Workers;
- canonical event metadata를 위한 D1;
- encrypted protected-value blob을 위한 R2;
- external operator/local credential custody. Authorization token hash는 D1에
  저장하고 raw credential은 local에 두며 Git 밖에 유지합니다.

향후 hosted component는 다음을 포함할 수 있습니다.

- extraction job을 위한 Workers;
- optional extraction과 embedding을 위한 Workers AI;
- optional semantic search를 위한 Vectorize;
- optional dashboard를 위한 Pages.

Workers AI와 Vectorize는 optional adapter입니다. CarpeOS는 가능한 경우 local
또는 self-hosted alternative도 지원해야 합니다.

개인 MVP에서는 모든 raw hook event를 embedding하지 않고 session summary,
decision, claim, selected evidence chunk 같은 의미 있는 knowledge unit만
embedding한다면 free-tier path가 유용할 것으로 예상합니다.
실제 운영 전에는 current Cloudflare limit을 official documentation 기준으로 다시
확인해야 합니다. G006 design update 기준으로 Workers AI free usage는
Neurons/day로, Vectorize free usage는 queried/stored vector dimensions로
문서화되어 있습니다. 이 quota는 operational limit이며 correctness guarantee가
아닙니다.

## MVP Roadmap

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
   - Claude Code lifecycle hooks
   - Grok Build lifecycle hooks
   - provider-neutral capture envelope

5. Sync 추가.
   - Cloudflare sync adapter
   - encrypted protected-value upload/download
   - cross-Mac private operator setup

6. Retrieval 추가.
   - structured search
   - full-text search
   - local vector projection
   - canonical recheck

7. Projection과 interface 추가.
   - Obsidian projection generator
   - context pack generation
   - MCP server
   - graph projection
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

CarpeOS는 pre-MVP 단계입니다. G006 local capture, sync, local retrieval runtime은
synthetic data로 구현 및 local test되어 있지만, packaged end-user release로
사용할 준비는 아직 되지 않았고 live deployment도 주장하지 않습니다.

계획된 MCP, adapter installation, Obsidian projection, GraphRAG, hosted
embedding, Vectorize operation, live deployment path는 이 저장소에서 구현, 테스트,
문서화되기 전까지 stable한 것으로 간주하지 마십시오.
