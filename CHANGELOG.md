# Changelog

All notable changes are documented here. The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

No changes yet.

## [0.3.3] - 2026-07-20

### Added

- An inline architecture flow that connects coding-agent assumptions, content-addressed Receipts, Git review, and deterministic CI outcomes.
- A copy-pasteable GitHub Actions adoption guide with read-only permissions, locked npm installation, and commit-pinned Actions.
- Regression tests that keep the public support scope, architecture, CI instructions, and cross-platform CI matrix aligned.

### Changed

- Project CI now runs the complete release gate on Linux and Windows with Node.js 22 and 24.
- English and Traditional Chinese first-visit documentation now state the supported and deliberately unsupported surfaces explicitly.
- The demo promise now describes a reproducible one-command path instead of making a network-dependent timing claim.

### Not included

- No Receipt schema, verification policy, network access, cloud service, or runtime-correctness claim changed in this release.

## [0.3.2] - 2026-07-17

### Added

- A complete Traditional Chinese README with the same Quick Start, trust boundaries, CLI commands, and deterministic error codes as the English documentation.
- A `/zh-TW/` GitHub Pages entry, Traditional Chinese FAQ, and a reproduced TypeScript signature-drift case study.
- Automated checks for bilingual navigation, localized discovery metadata, translated documentation coverage, and inclusion of `README.zh-TW.md` in the npm tarball.

### Changed

- English and Traditional Chinese documentation now link to each other explicitly.
- Package, CLI, GitHub Pages, npm, and MCP Registry metadata now align on `0.3.2`.

### Not included

- CLI commands, Receipt schema fields, error codes, API names, and machine-readable output remain English to keep CI and agent integrations stable.
- No verification behavior, network access, cloud service, or runtime-correctness claim changed in this release.

## [0.3.1] - 2026-07-17

### Added

- A static GitHub Pages discovery site with canonical metadata, social previews, structured software facts, `robots.txt`, `sitemap.xml`, and an agent-readable `llms.txt`.
- Plain-language FAQ answers for TypeScript API drift, OpenAPI contract drift, contract testing, coding-agent support, and Evidrift's trust boundary.
- A 1200×675 animated demo rendered from a captured, deterministic CLI PASS-to-FAIL transcript.
- Automated first-visit checks for the README demo, website CTA, captured transcript, and lightweight GIF.

### Changed

- GitHub, npm, README, and MCP descriptions now lead with the concrete TypeScript API and OpenAPI drift use case.
- npm search keywords now include API drift, contract testing, evidence lockfiles, OpenAPI drift, and TypeScript MCP.
- README and GitHub Pages now lead with the zero-install demo before repository setup.
- Running `evidrift` without arguments exits successfully with a copy-pasteable demo command; `evidrift init` prints concrete next steps.
- Package, CLI, MCP Registry, and release metadata now align on `0.3.1`.

### Not included

- No verification behavior, Receipt schema, network access, cloud service, or runtime-correctness claim changed in this release.

## [0.3.0] - 2026-07-16

### Added

- Call-site overload resolution: when `--code path:line` identifies an overloaded call, Evidrift records the declaration selected by the consumer's TypeScript compiler configuration.
- A deterministic `json.pointer` adapter for repository-local `.json` files, exposed through CLI and MCP with RFC 6901 escaping.
- JSON drift classification: unrelated document edits warn, selected value changes or removal block, and invalid/unavailable JSON remains visibly unverifiable.
- Runnable JSON Pointer example plus CLI, MCP, integrity, RFC edge-case, and boss-fight acceptance coverage.

### Changed

- Invalid, ambiguous, or missing overloaded calls are refused rather than guessed; explicit `--overload` remains the fallback.
- Receipt schema v1 now accepts both `typescript.symbol` and `json.pointer` evidence without invalidating existing v0.1/v0.2 Receipts.
- Package, CLI, MCP Registry, and release metadata now align on `0.3.0`.

### Not included

- Cloud accounts, hosted storage, Dashboard, URL fetching, YAML, remote `$ref`, runtime execution, or LLM judging.

## [0.2.0] - 2026-07-16

### Added

- Explicit 1-based `--overload` and MCP `overload` selectors for overloaded TypeScript symbols.
- Boss-fight acceptance coverage for cross-file aliases, selection errors, reordering, and selected-overload drift.
- A 64-call-signature resource bound before overload candidate rendering.
- A package-level `evidrift mcp` entry point and official MCP Registry metadata.
- A tag-gated GitHub/npm/MCP release workflow with version alignment and registry readback.

### Changed

- Revalidation now finds a previously recorded signature by content hash across the current overload set, so declaration reordering and unrelated overload insertion remain stable.
- The package and CLI development version are now `0.2.0`; Receipt schema v1 remains backward compatible.

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
