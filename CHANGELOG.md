# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

No changes yet.

## [0.1.0] - 2026-07-15

### Added

- TypeScript/Node.js CLI with `init`, `record`, `check`, `diff`, `explain`, and `demo`.
- Local STDIO MCP server exposing `evidrift_record` through the shared core.
- Canonical, content-addressed Evidence Receipts and strict untrusted-input checks.
- Deterministic `typescript.symbol` adapter for installed dependency signatures.
- Reproducible signature-drift example, unit/integration tests, and CLI/MCP smoke coverage.
- Pinned GitHub Actions verification workflow and public-project documentation.
- Reproducible UAT suite and acceptance report covering CLI, MCP, drift, tampering, invalid input, and trust-boundary behavior.
- Validation that affected-code locations resolve to real repository files before recording.
- Resource-bound validation for Receipt counts and transitive TypeScript declaration reads.
- UAT coverage for control-character injection, literal whitespace drift, external declaration escapes, resource exhaustion, and demo cleanup junctions.
- A boss-fight fixture proving current behavior for overload sets with complex cross-file type aliases.
- Self-contained `evidrift demo` command that records a passing contract, changes it, and displays the deterministic failure.
- TTY-only Chalk colors, status icons, and Ora progress feedback with ANSI-free CI and pipe output.

### Changed

- Renamed the pre-release project, package, CLI, MCP tool, evidence directory, fixtures, and documentation from the former prototype name to Evidrift.
- Integrity failures now include a plain-text recovery action for developers and coding agents.
- MCP input is strict and rejects raw status fields such as `verified`.
- README now leads with the product's one-line purpose, source installation, and a runnable quick start.
- Signature normalization preserves whitespace inside string, template, and quoted literal types.
- Every build removes stale `dist` output before compiling.
- Published the public `evidrift@0.1.0` npm package with `evidrift` and `evidrift-mcp` executables.

### Not included

- Cloud services, UI, RAG, LLM judging, arbitrary command receipts, auto-fix, or signing.
