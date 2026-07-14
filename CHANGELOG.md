# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Reproducible UAT suite and acceptance report covering CLI, MCP, drift, tampering, invalid input, and trust-boundary behavior.
- Validation that affected-code locations resolve to real repository files before recording.
- Resource-bound validation for Receipt counts and transitive TypeScript declaration reads.
- UAT coverage for control-character injection, literal whitespace drift, external declaration escapes, resource exhaustion, and demo cleanup junctions.
- A boss-fight fixture proving current behavior for overload sets with complex cross-file type aliases.

### Changed

- Integrity failures now include a plain-text recovery action for developers and coding agents.
- MCP input is strict and rejects raw status fields such as `verified`.
- README now leads with the product's one-line purpose, source installation, and a runnable quick start.
- Signature normalization preserves whitespace inside string, template, and quoted literal types.
- Every build removes stale `dist` output before compiling.

## [0.1.0] - 2026-07-14

### Added

- TypeScript/Node.js CLI with `init`, `record`, `check`, `diff`, and `explain`.
- Local STDIO MCP server exposing `litmo_record` through the shared core.
- Canonical, content-addressed Evidence Receipts and strict untrusted-input checks.
- Deterministic `typescript.symbol` adapter for installed dependency signatures.
- Reproducible signature-drift example, unit/integration tests, and CLI/MCP smoke coverage.
- Pinned GitHub Actions verification workflow and public-project documentation.

### Not included

- npm publication, cloud services, UI, RAG, LLM judging, arbitrary command receipts, auto-fix, or signing.
