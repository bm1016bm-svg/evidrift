# Security policy

## Supported versions

Only the latest published `0.x` release on `main` receives security fixes before 1.0.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository when available. Do not include exploit details, credentials, or private repository content in a public issue. If private reporting is unavailable, open a minimal public issue asking the maintainer to establish a private channel, without disclosing the vulnerability.

Include the affected commit, platform, reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgement within seven days; this is a response target, not a guaranteed service level.

## Security model

Evidrift treats `.evidrift/evidence.lock` and every Receipt as untrusted input. Its adapters read bounded repository-local JSON and TypeScript source/declaration files; they do not execute dependencies, package scripts, shell commands, network requests, or LLM calls.

Security-sensitive reports include:

- path traversal or reads outside the repository;
- content-hash or canonicalization bypasses;
- trust in receipt-provided `matched`/`verified` state;
- arbitrary execution triggered by a receipt;
- a deterministic mismatch incorrectly reported as pass;
- MCP inputs bypassing CLI/core validation.

Evidrift does not scan dependencies for vulnerabilities and does not prove runtime safety.
