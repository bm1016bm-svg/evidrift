# Security policy

## Supported versions

Only the latest published `0.x` release on `main` receives security fixes before 1.0.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository when available. Do not include exploit details, credentials, or private repository content in a public issue. If private reporting is unavailable, open a minimal public issue asking the maintainer to establish a private channel, without disclosing the vulnerability.

Include the affected commit, platform, reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgement within seven days; this is a response target, not a guaranteed service level.

## Security model

Evidrift treats `.evidrift/evidence.lock`, every Receipt, ReproMin request fixture, and reproduction artifact as untrusted input. Contract adapters read bounded repository-local JSON and TypeScript source/declaration files; they do not execute dependencies, package scripts, shell commands, network requests, or LLM calls.

ReproMin is a separate CLI-only boundary. After explicit confirmation it repeatedly sends JSON to a literal loopback HTTP target. It refuses redirects, remote/LAN/hostname targets, proxy configuration, common secret-shaped names and high-confidence token patterns, invalid UTF-8 fixtures, oversized inputs/responses, and artifact hash mismatches. Probe counts and fixed-size candidate-cache keys are bounded. It never runs from `evidrift check` or MCP. Secret detection is not a data-loss-prevention guarantee, and these controls do not remove application side effects; use synthetic data and a disposable local fixture.

Security-sensitive reports include:

- path traversal or reads outside the repository;
- content-hash or canonicalization bypasses;
- trust in receipt-provided `matched`/`verified` state;
- arbitrary execution triggered by a receipt;
- a deterministic mismatch incorrectly reported as pass;
- MCP inputs bypassing CLI/core validation or transport bounds;
- SSRF, redirect, proxy, or address-parsing bypasses in ReproMin;
- credentials or raw response data leaking into artifacts or terminal output;
- a minimized artifact being written when the baseline or final failure predicate did not match;
- replay occurring without explicit CLI confirmation; and
- probe-budget, timeout, response-size, or JSON resource limits being bypassed.

Evidrift does not scan dependencies for vulnerabilities and does not prove runtime safety.
