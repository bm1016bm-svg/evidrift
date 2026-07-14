# Litmo

> **Litmo: The lockfile for AI assumptions.**

AI can write code against a dependency contract that changes tomorrow. Litmo records that contract in the repository, then checks the installed dependency again before merge.

It is a local TypeScript CLI and STDIO MCP server. No cloud account. No LLM judge. No package code execution.

## Installation

Litmo is not on npm yet. Build it from a repository checkout with Node.js 22 or newer:

```bash
npm ci
npm run build
npm link
litmo --help
```

Do not want a global link? Replace `litmo` with `node /absolute/path/to/litmo/dist/src/cli.js`.

## Quick Start

Run the complete signature-drift demo:

```bash
npm ci
npm run build
npm run demo
```

The demo does four things: records the optional `options` parameter on `parseConfig`, checks it successfully, changes the fixture so `options` is required, then fails deterministically.

```text
FAIL contract_mismatch sha256:...
Claim: parseConfig accepts an optional options parameter used by the demo.
Expected signature: parseConfig(input:string,options?:ParseOptions):ParseResult
Current signature: parseConfig(input:string,options:ParseOptions):ParseResult
Affected code location: app/src/index.ts:3
Receipt ID: sha256:...
Action: Review the dependency change and affected code, then intentionally record a new receipt.
```

That is the product: make an AI assumption reviewable now, then make CI check the same contract later.

## Use It in a Repository

The dependency must already be installed inside the target repository, and the affected code path must name a real file.

```bash
cd /path/to/your/repository
litmo init

litmo record \
  --project . \
  --package your-package \
  --symbol exportedFunction \
  --parameter options \
  --claim "exportedFunction accepts the options used here." \
  --code src/caller.ts:12

litmo check
```

Coding agents call the same record path through `litmo_record`. Minimal [Codex, Claude Code, and Cursor setup](docs/mcp.md) is included.

## The Files

Litmo writes one lock and one immutable JSON file per Receipt:

```text
.litmo/
  evidence.lock
  receipts/
    <64-character-sha256>.json
```

There is no `.litmo/receipts.json`. `evidence.lock` contains only content-addressed Receipt IDs:

```json
{
  "receipts": ["sha256:9bfbb065cff372abe52e8e269123959e9f2ae84cd02230dc751f768ac5e4c274"],
  "schemaVersion": 1
}
```

Each Receipt stores the claim, affected code, installed package version, resolved declaration path, symbol or parameter, normalized signature, and signature hash. See the [Receipt schema](docs/receipt-schema.md).

## CI Behavior

`litmo check` does not trust saved `matched` or `verified` flags. It validates the Receipt, resolves the installed package again, and recomputes the signature.

| Result                    | Meaning                                                        | Exit |
| ------------------------- | -------------------------------------------------------------- | ---: |
| `PASS`                    | The deterministic signature still matches                      |    0 |
| `WARNING source_changed`  | Version or resolved path changed, but the signature matches    |    0 |
| `WARNING unverifiable`    | Source is missing, invalid, or cannot be inspected             |    0 |
| `FAIL contract_mismatch`  | Signature, symbol, or supported callable contract changed      |    1 |
| `FAIL evidence_integrity` | Lock or Receipt is malformed, missing, forged, or hash-invalid |    2 |

A one-line manual edit to a Receipt produces an actionable integrity report:

```text
FAIL evidence_integrity sha256:...
Message: Receipt content hash mismatch.
Receipt ID: sha256:...
Action: Do not trust or hand-edit this Receipt. Restore it from version control, or intentionally create a new Receipt with `litmo record`.
```

The included GitHub Actions workflow runs the full gate on Node.js 22 and 24. Third-party Actions are pinned to full commit SHAs.

## Why This Is Not RAG, Sonar, or AI Review

| Tool                  | Its job                                        | Litmo's job                                            |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| RAG                   | Fetch context while an answer is being written | Commit one assumption and check it again later         |
| Sonar/static analysis | Find code patterns and quality problems        | Revalidate an explicit external dependency contract    |
| AI code review        | Make a probabilistic judgment                  | Produce a deterministic result without an LLM CI judge |

Use all of them if they help. Litmo covers one gap: the reason code was written can go stale even when the code itself did not change.

## CLI

```text
litmo init
litmo record --project <path> --package <name> --symbol <name> \
  [--parameter <name>] --claim <text> --code <path[:line]>
litmo check
litmo diff
litmo explain <receipt-id>
```

All commands accept `--root <repo>`. `record` requires an initialized `.litmo/evidence.lock`.

## Trust Boundary

`.litmo/receipts/*.json` is untrusted input. Every check:

1. Strictly validates lock and Receipt schemas.
2. Derives file paths only from full SHA-256 IDs.
3. Recomputes the expected-signature hash and Receipt content hash.
4. Resolves declarations without importing package JavaScript, running shell commands, making network requests, or calling an LLM.
5. Reports evidence integrity, source drift, semantic support, and runtime correctness separately.

The parser refuses more than 1,024 Receipt IDs. TypeScript evidence is confined to repository files and capped at 256 source files, 2 MiB per file, and 16 MiB total. Dynamic text is rejected or escaped so a Receipt cannot inject terminal controls or fake CI lines.

Content hashes detect inconsistent edits; they do not prove authorship. Someone who rewrites a Receipt, recalculates its ID, and changes `evidence.lock` can create new internally valid evidence. Git review and branch protection must catch that replacement. See [Architecture](docs/architecture.md).

## What Litmo Does Not Prove

Litmo does not prove code is correct. It does not prove a free-text claim is true, inspect runtime behavior, eliminate hallucinations, scan dependency vulnerabilities, or validate arbitrary URLs.

v0.1 checks one exported TypeScript symbol with exactly one call signature. It follows repository-local declaration imports, but does not expand every named type into a deep structural contract. Missing or unreadable source is a visible but non-blocking warning. These are deliberate limits, not hidden guarantees.

The runnable [boss-fight test](examples/boss-fight-test/README.md) shows the exact behavior for three overloads using a complex cross-file type alias: `record` refuses the overload set cleanly and writes no Receipt.

## Development and UAT

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run uat
npm run check
```

`npm run verify` runs the release gate. Tests use temporary local fixtures and require no secrets, paid APIs, Litmo backend, or network access. The detailed [UAT report](docs/UAT.md) maps each acceptance case to an automated test and states the remaining risks.

## License

[Mozilla Public License 2.0](LICENSE).
