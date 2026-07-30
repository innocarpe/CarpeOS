# Security Policy

CarpeOS is designed around a clear separation:

**The source code can be public. A user's knowledge store is private.**

Security must not depend on hiding this repository.

## Public Repository Boundary

The public repository may contain:

- source code;
- specifications;
- migrations;
- tests;
- synthetic fixtures;
- documentation;
- example configuration without secrets.

The public repository must not contain:

- real user knowledge;
- real AI session transcripts;
- private repository URLs;
- production logs;
- local filesystem paths;
- credentials, tokens, cookies, passwords, API keys, or private keys;
- runtime SQLite databases;
- D1, R2, Vectorize, or Obsidian exports from a private instance;
- local agent harness session state (for example `.gjc/`, `.omx/`).

CI enforces this boundary with:

- `scripts/check-public-boundary.mjs` (via `pnpm check`) for protected paths, home
  paths, and non-placeholder Cloudflare identifiers;
- the **Secret scan** workflow (`gitleaks`) for high-entropy secrets across git
  history on every pull request and `main` push.

## Private Runtime Boundary

Private instance state should live outside the repository. Examples include:

- local runtime directories;
- encrypted evidence stores;
- device enrollment material;
- sync credentials;
- private Obsidian projections;
- local caches and outboxes.

Generated projections are not authoritative. If a projection leaks or becomes
stale, the canonical event store should remain the recovery point.

See [Threat Model](docs/architecture/threat-model.md) for the G008 asset,
boundary, adversary, control, residual-risk, and non-goal model.

## G008 Security Status

G008 proves release readiness with local documentation and synthetic tests only.
It does not prove a hosted Worker, production D1/R2 resources, package publish,
private vault adoption, hosted MCP, or cross-Mac live deployment.

Maintainers should use
[Release Readiness](docs/maintainers/release-readiness.md) before claiming a
release, CI result, deployment, or private operator adoption.

## Reporting a Vulnerability

Please do not disclose vulnerabilities publicly before maintainers have had a
reasonable chance to respond.

For now, open a private security advisory on GitHub if available. If that is not
available, contact the repository owner through a non-public channel listed on
the GitHub profile.

Include:

- affected component;
- impact;
- reproduction steps using synthetic data;
- whether credentials or private runtime data could be exposed;
- suggested mitigation, if known.

Do not include real session transcripts, credentials, or private project data in
the report.

## Expected Security Areas

CarpeOS expects security review around:

- local device identity;
- event signing and replay protection;
- encrypted evidence storage;
- sync authorization;
- redaction before telemetry or logs;
- MCP tool permission boundaries;
- prompt and transcript capture controls;
- projection export controls.

These areas are part of the planned security model and should not be treated as
fully implemented until code, tests, and documentation exist in this repository.
