# Evidrift — replay-verified JSON reductions and API drift evidence

[English](README.md) | [繁體中文](README.zh-TW.md)

[![CI](https://github.com/bm1016bm-svg/evidrift/actions/workflows/ci.yml/badge.svg)](https://github.com/bm1016bm-svg/evidrift/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/evidrift.svg)](https://www.npmjs.com/package/evidrift)
[![Website](https://img.shields.io/badge/docs-GitHub%20Pages-111111.svg)](https://bm1016bm-svg.github.io/evidrift/)
[![Indexed on TensorBlock MCP Index](https://mcp-index.tensorblock.co/v1/servers/github-bm1016bm-svg-evidrift-85713ef9/badge.svg)](https://www.tensorblock.co/mcp/servers/github-bm1016bm-svg-evidrift-85713ef9)

> **Failures arrive noisy. APIs drift quietly. Evidrift turns both into deterministic evidence.**

Evidrift has two deliberately separate workflows:

- **ReproMin** repeatedly removes JSON data, replays each candidate against a disposable local HTTP target, and keeps only reductions that still match the selected failure identity.
- **Contract drift** records an exact TypeScript call signature or repository JSON value as a content-addressed Receipt, then makes CI recompute it before merge.

Local-first CLI. STDIO MCP server for contract recording only. No account, cloud backend, telemetry, or LLM judge.

![Evidrift — AI dependency lockfile](https://raw.githubusercontent.com/bm1016bm-svg/evidrift/main/docs/assets/evidrift-hero.png)

[![Real Evidrift CLI demo: a dependency contract passes, its TypeScript signature changes, and Evidrift catches the drift before merge](https://raw.githubusercontent.com/bm1016bm-svg/evidrift/main/docs/assets/evidrift-demo.gif)](#quick-start--see-drift-in-one-command)

The animation is rendered from a [captured CLI transcript](https://github.com/bm1016bm-svg/evidrift/blob/main/docs/assets/evidrift-demo-transcript.txt). The PASS, changed signatures, affected file, and deterministic FAIL come from an actual local `evidrift demo` run; only the scene headings are editorial.

## Quick Start — Minimize a Failing Request

Requires Node.js 22 or newer. The zero-setup demo starts a disposable loopback server, verifies one HTTP failure, minimizes its JSON request, verifies the result again, and shuts the server down:

```bash
npx --yes evidrift@latest repro-demo
```

The result is not selected by an LLM. Every accepted reduction is actually replayed and must match both the expected HTTP status and error identity.

For your own local endpoint:

```bash
npx evidrift minimize \
  --request failing-request.json \
  --status 500 \
  --response-pointer /error/code \
  --response-equals '"INVALID_FILTER"' \
  --output minimal-repro.json \
  --confirm-replay yes
```

Then replay the content-addressed artifact once:

```bash
npx evidrift reproduce --artifact minimal-repro.json --confirm-replay yes
```

See the complete [ReproMin fixture, guarantees, and replay safety boundary](docs/repro-min.md).

## Quick Start — See Drift in One Command

Requires Node.js 22 or newer. Nothing to install globally:

```bash
npx --yes evidrift@latest demo
```

The command creates a disposable local fixture, records the optional `options` parameter on `parseConfig`, checks it successfully, changes the fixture so `options` is required, then proves that `evidrift check` catches the mismatch. It runs no downloaded package code.

**If that is a failure you want caught before merge, [star Evidrift on GitHub](https://github.com/bm1016bm-svg/evidrift).**

## Real-world Lab — React 19 `useRef`

The synthetic demo is fast; this source-repository lab proves the same workflow against a real,
documented ecosystem change. React's official upgrade guide says React 19 makes the first
`useRef` argument required. Evidrift records the no-argument overload from
`@types/react@18.3.12`, upgrades only that type package to `@types/react@19.0.1`, and reports the
missing overload:

```bash
git clone https://github.com/bm1016bm-svg/evidrift.git
cd evidrift
npm ci --ignore-scripts
npm run demo:react-19
```

Both package versions are exact and verified after installation. The lab disables dependency
lifecycle scripts, and its final `evidrift check` must return a deterministic contract mismatch.
See the [reproduction and complete trust boundary](examples/react-19-useref/README.md) and the
[official React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide#useref-requires-an-argument).

## Supported Today

| Surface                                         | Deterministic evidence                                               | Status             |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------------ |
| Loopback HTTP JSON failure                      | Replayed reduction matching status plus error identity               | CLI only           |
| Installed TypeScript dependency                 | Selected call signature, parameter, package version, and declaration | Supported          |
| Repository OpenAPI / JSON Schema                | Canonical value selected through an RFC 6901 JSON Pointer            | Supported for JSON |
| Contract CLI and local STDIO MCP                | The same record and revalidation core                                | Supported          |
| Remote replay, cURL import, YAML, remote `$ref` | None; Evidrift refuses these inputs instead of guessing              | Not supported      |

## Installation — Add It to a Repository

Initialize the current repository without a global install, account, API key, or cloud backend:

```bash
npx --yes evidrift@latest init
```

To add an idempotent pull-request workflow with file-and-line annotations:

```bash
npx --yes evidrift@latest init --github-actions
```

The initializer detects npm, pnpm, or Yarn, adds `scripts.evidrift:check`, and creates
`.github/workflows/evidrift.yml`. Existing scripts and workflows are reported and preserved
instead of being overwritten.

To pin Evidrift for a team or CI workflow:

```bash
npm install --save-dev evidrift
npx evidrift init
```

That is the product: make an AI assumption reviewable now, then make CI check the same contract later.

## Use It in a Repository

The dependency must already be installed inside the target repository, and the affected code path must name a real file.

```bash
cd /path/to/your/repository
evidrift init

evidrift record \
  --project . \
  --package your-package \
  --symbol exportedFunction \
  --parameter options \
  --claim "exportedFunction accepts the options used here." \
  --code src/caller.ts:12

evidrift check
```

When `--code` includes a line containing an overloaded call, Evidrift asks TypeScript which overload that call actually resolves to. `--overload <number>` remains an explicit fallback for incomplete or non-compiling call sites.

Lock one value from a repository-local OpenAPI or JSON Schema document:

```bash
evidrift record \
  --json openapi.json \
  --pointer /paths/~1users/get/operationId \
  --claim "The generated client calls listUsers." \
  --code src/client.ts:24
```

JSON Pointer follows RFC 6901, including `~1` for `/` and `~0` for `~`. Evidrift reads `.json` files only; it never fetches URLs or resolves remote references.

Coding agents call the same core through `evidrift_record` and `evidrift_record_json_pointer`. Minimal [Codex, Claude Code, and Cursor setup](docs/mcp.md) is included.

## How It Works

```mermaid
flowchart LR
  Author["Developer"] --> Minimize["Minimize failing JSON"]
  Minimize --> Replay["Replay loopback failure"]
  Replay --> Repro["Content-addressed reproduction"]
  Agent["Coding agent or developer"] --> Record["Record one assumption"]
  Record --> Adapter["TypeScript or JSON adapter"]
  Adapter --> Receipt["Content-addressed Receipt"]
  Receipt --> Review["Git review"]
  Review --> Check["evidrift check in CI"]
  Check --> Result{"Contract still matches?"}
  Result -->|Yes| Pass["PASS"]
  Result -->|Source unavailable| Warn["WARNING"]
  Result -->|No or tampered| Fail["FAIL"]
```

The CLI and MCP server are thin entry points over the same core. The complete component map, check policy, resource bounds, and trust boundary are documented in [Architecture](docs/architecture.md).

## The Files

Evidrift writes one lock and one immutable JSON file per Receipt:

```text
.evidrift/
  evidence.lock
  receipts/
    <64-character-sha256>.json
```

There is no `.evidrift/receipts.json`. `evidence.lock` contains only content-addressed Receipt IDs:

```json
{
  "receipts": ["sha256:9bfbb065cff372abe52e8e269123959e9f2ae84cd02230dc751f768ac5e4c274"],
  "schemaVersion": 1
}
```

Each Receipt stores the claim and affected code plus one deterministic contract: an installed TypeScript symbol signature, or a repository JSON path, pointer, canonical value, and hashes. See the [Receipt schema](docs/receipt-schema.md).

## Add It to CI

Generate the package script and read-only pull-request workflow:

```bash
npx evidrift init --github-actions
```

The generated package script pins the current Evidrift release:

```json
{
  "scripts": {
    "evidrift:check": "npx --yes evidrift@0.4.1 check"
  }
}
```

Run the same pinned check locally with `npm run evidrift:check`.

The generated workflow installs locked repository dependencies with lifecycle scripts disabled,
then runs the Marketplace Action. Contract mismatches and integrity failures become PR errors at
the affected file and line; source-change and unavailable-evidence results become warnings.

```bash
evidrift check --annotations github
```

With `--format json`, GitHub workflow commands are written to standard error so standard output
remains valid JSON. The complete [GitHub Actions setup](docs/ci.md) documents the generated
workflow, permissions, package-manager behavior, and manual setup.

The root `action.yml` provides a Marketplace-ready contract check. It runs only the
network-free contract workflow; ReproMin replay is never triggered by that Action.

## CI Behavior

`evidrift check` does not trust saved `matched` or `verified` flags. It validates the Receipt, reloads the source, and recomputes the selected signature or JSON value.

| Result                    | Meaning                                                            | Exit |
| ------------------------- | ------------------------------------------------------------------ | ---: |
| `PASS`                    | The deterministic signature or JSON value still matches            |    0 |
| `WARNING source_changed`  | Source identity/content changed, but the selected contract matches |    0 |
| `WARNING unverifiable`    | Source is missing, invalid, or cannot be inspected                 |    0 |
| `FAIL contract_mismatch`  | Selected TypeScript signature or JSON value changed/disappeared    |    1 |
| `FAIL evidence_integrity` | Lock or Receipt is malformed, missing, forged, or hash-invalid     |    2 |

For CI systems, coding agents, and other tools, request a versioned JSON report without changing those exit codes:

```bash
npx evidrift check --format json
```

The report includes `schemaVersion`, the Evidrift version, summary counts, and the ordered `CheckResult` objects. It contains no timestamp or absolute repository root, so equal results serialize identically. See the [JSON check report contract](docs/check-report.md).

A one-line manual edit to a Receipt produces an actionable integrity report:

```text
FAIL evidence_integrity sha256:...
Message: Receipt content hash mismatch.
Receipt ID: sha256:...
Action: Do not trust or hand-edit this Receipt. Restore it from version control, or intentionally create a new Receipt with `evidrift record`.
```

The project workflow runs the full gate on Linux and Windows with Node.js 22 and 24. Third-party Actions are pinned to full commit SHAs.

In a human TTY, `check`, `diff`, `explain`, and `demo` use a spinner plus green `✅`, yellow `⚠`, and red `❌` status output. Redirected output, CI, `TERM=dumb`, and `NO_COLOR` stay ANSI-free and keep the stable plain-text format used by agents and tests.

## Why This Is Not RAG, Sonar, or AI Review

| Tool                  | Its job                                        | Evidrift's job                                         |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| RAG                   | Fetch context while an answer is being written | Commit one assumption and check it again later         |
| Sonar/static analysis | Find code patterns and quality problems        | Revalidate an explicit external dependency contract    |
| AI code review        | Make a probabilistic judgment                  | Produce a deterministic result without an LLM CI judge |

Use all of them if they help. Evidrift covers one gap: the reason code was written can go stale even when the code itself did not change.

## Frequently Asked Questions

### What is API drift?

API drift is a change to a dependency or contract after code was written against it. Evidrift checks two deterministic forms: the TypeScript call signature selected at an affected code location, and a canonical value selected from repository-local OpenAPI JSON or JSON Schema.

### Is Evidrift a contract-testing tool?

It is narrower than end-to-end contract testing. Contract tests exercise provider and consumer behavior; Evidrift locks one explicit assumption that influenced code and revalidates that assumption in CI without running dependency code.

### Does Evidrift work with Codex, Claude Code, and Cursor?

Yes. They can call the local STDIO MCP server to create Receipts through the shared verification core. The agent cannot directly mark a Receipt as verified. See the [minimal MCP configurations](docs/mcp.md).

### Does Evidrift fetch OpenAPI URLs or execute package code?

The contract adapters do not. They inspect installed TypeScript declarations and repository-local `.json` files without fetching URLs, resolving remote `$ref`, importing dependency JavaScript, or executing arbitrary commands.

`minimize` and `reproduce` are separate, explicit replay commands. They send JSON only to literal loopback HTTP addresses after `--confirm-replay yes`; they never run during `check` or through the MCP tools.

### Does Evidrift prove that AI-generated code is correct?

No. It detects deterministic evidence drift and Receipt tampering. It does not prove runtime correctness, validate free-text semantics, or eliminate hallucinations. See [What Evidrift Does Not Prove](#what-evidrift-does-not-prove).

## CLI

```text
evidrift init [--github-actions]
evidrift record --project <path> --package <name> --symbol <name> \
  [--parameter <name>] [--overload <number>] --claim <text> --code <path[:line]>
evidrift record --json <path> --pointer <RFC6901> --claim <text> --code <path[:line]>
evidrift check [--format text|json] [--annotations none|github]
evidrift diff
evidrift explain <receipt-id>
evidrift demo
evidrift repro-demo
evidrift minimize --request <json> --status <code> \
  (--response-contains <text> | --response-pointer <RFC6901> --response-equals <json>) \
  --output <json> --confirm-replay yes
evidrift reproduce --artifact <json> --confirm-replay yes
evidrift mcp
```

Repository-scoped commands accept `--root <repo>`. `record` requires an initialized `.evidrift/evidence.lock`; `repro-demo` and `mcp` do not use a repository root.

`evidrift mcp` starts the same local STDIO server exposed by the `evidrift-mcp` bin. It exists so package registries and MCP clients can launch Evidrift deterministically from the main npm package.

## Trust Boundary

`.evidrift/receipts/*.json` is untrusted input. Every check:

1. Strictly validates lock and Receipt schemas.
2. Derives file paths only from full SHA-256 IDs.
3. Recomputes the expected contract hash and Receipt content hash.
4. Resolves declarations or repository-local JSON without importing package JavaScript, running shell commands, making network requests, or calling an LLM.
5. Reports evidence integrity, source drift, semantic support, and runtime correctness separately.

The parser refuses more than 1,024 Receipt IDs or 64 call signatures per symbol. TypeScript evidence is confined to repository files and capped at 256 source files, 2 MiB per file, and 16 MiB total. JSON sources are capped at 4 MiB and selected canonical values at 1 MiB. Dynamic text is rejected or escaped so a Receipt cannot inject terminal controls or fake CI lines.

Content hashes detect inconsistent edits; they do not prove authorship. Someone who rewrites a Receipt, recalculates its ID, and changes `evidence.lock` can create new internally valid evidence. Git review and branch protection must catch that replacement. See [Architecture](docs/architecture.md).

ReproMin has a separate boundary because replay can cause side effects. It accepts only literal loopback HTTP targets, refuses redirects and common secret-shaped input, requires explicit replay confirmation, caps requests and response inspection, and never runs from `check` or the MCP server. The artifact records what Evidrift observed; its content hash detects inconsistent edits but does not authenticate probe history. `reproduce` verifies one current replay.

## What Evidrift Does Not Prove

Evidrift does not prove code is correct. The contract workflow does not prove a free-text claim, execute runtime behavior, eliminate hallucinations, scan dependency vulnerabilities, or validate arbitrary URLs.

ReproMin does not prove a global minimum or identify the root cause. Without an exhausted budget it establishes only 1-minimality under its documented JSON reducers and the chosen failure predicate. A weak predicate can still describe the wrong bug, which is why status alone is rejected.

The contract workflow resolves overloaded TypeScript calls from the affected `path:line` when the consumer code compiles and TypeScript can identify one declared overload. Invalid, ambiguous, or missing calls are refused rather than guessed; `--overload` is the explicit fallback. The Receipt stores the selected normalized signature and hash, so declaration reordering does not cause false drift.

The `json.pointer` adapter locks canonical values in repository-local `.json` files. It does not support YAML, URLs, remote `$ref`, schema validation, or semantic equivalence. It follows repository-local TypeScript declaration imports, but does not expand every named type into a deep structural contract. Missing or unreadable source is a visible but non-blocking warning. These are deliberate limits, not hidden guarantees.

The runnable [boss-fight test](examples/boss-fight-test/README.md) resolves one of three overloads from a real call using a complex cross-file type alias, survives declaration reordering, and deterministically fails when only the selected overload changes.

## Development and UAT

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run uat
npm run check
```

`npm run verify` runs the release gate. Tests use temporary fixtures and disposable loopback servers; they require no secrets, paid APIs, Evidrift backend, or external network access. The detailed [UAT report](docs/UAT.md) maps each acceptance case to an automated test and states the remaining risks.

## License

[Mozilla Public License 2.0](LICENSE).
