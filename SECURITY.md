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
- D1, R2, Vectorize, or Obsidian exports from a private instance.

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
