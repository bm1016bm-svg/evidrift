# Litmo

> Version control for the “why” behind your code.<br>
> Reality checks for AI-generated code, revalidated in CI.

Litmo is a repo-native, local-first CLI and STDIO MCP server. A coding agent records an important external assumption as a content-addressed Evidence Receipt; `litmo check` resolves the installed dependency again and recomputes the deterministic contract before merge.

Litmo v0.1 answers one narrow question well: **does this installed TypeScript dependency still expose the symbol and signature that this code was written against?**

## How it differs

| Tool                  | Primary job                                             | What Litmo adds                                                                |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| RAG                   | Retrieve context while an agent is generating an answer | A small, reviewable artifact committed to the repository and revalidated later |
| Sonar/static analysis | Analyze code against rules and code-quality checks      | Revalidation of an explicitly recorded external dependency contract            |
| AI code review        | Probabilistically review a change                       | A deterministic CI result for a supported adapter, without an LLM judge        |

Litmo complements these tools; it is not a replacement for tests, static analysis, review, or dependency security scanning.

## 60-second demo

Prerequisites: Node.js 22+ and npm. From this repository checkout:

```bash
npm ci
npm run build
npm run demo
```

The demo creates an ignored `.litmo-demo/` workspace, records the optional `options` parameter on `parseConfig`, passes once, changes the fixture signature so `options` is required, and fails deterministically:

```text
FAIL contract_mismatch sha256:...
Claim: parseConfig accepts an optional options parameter used by the demo.
Expected signature: parseConfig(input:string,options?:ParseOptions):ParseResult
Current signature: parseConfig(input:string,options:ParseOptions):ParseResult
Affected code location: app/src/index.ts:3
Receipt ID: sha256:...
Action: Review the dependency change and affected code, then intentionally record a new receipt.
```

The same flow is covered by the automated smoke test.

## What `evidence.lock` looks like

```json
{
  "receipts": ["sha256:9bfbb065cff372abe52e8e269123959e9f2ae84cd02230dc751f768ac5e4c274"],
  "schemaVersion": 1
}
```

The referenced receipt records the claim, affected code, package version, repo-relative resolved declaration path, symbol, parameter, normalized signature, and signature hash. See [Receipt schema](docs/receipt-schema.md).

## What CI reports when a dependency changes

- Same signature, different package version or resolved path: `WARNING source_changed`, exit `0`.
- Different deterministic signature, missing symbol, or non-callable symbol: `FAIL contract_mismatch`, exit `1`.
- Invalid lock, malformed receipt, unknown fields, or content-hash mismatch: `FAIL evidence_integrity`, exit `2`.
- Source cannot be resolved or parsed: `WARNING unverifiable`, exit `0` in v0.1.

Only a deterministic contract mismatch blocks by default. Source identity change alone does not.

## What Litmo cannot guarantee

Litmo does **not** prove that code is correct, prove that a free-text claim is true, execute the code, eliminate AI hallucinations, assess package security, or predict runtime behavior. It checks only the contract captured by a supported deterministic adapter. v0.1 supports one adapter and one call signature per symbol.

## Install from source

Litmo is not published to npm. Build and link the CLI from a checkout:

```bash
npm ci
npm run build
npm link
litmo --help
```

You can avoid a global link by running `node dist/src/cli.js` and `node dist/src/mcp.js` directly.

## CLI

```text
litmo init
litmo record --project <path> --package <name> --symbol <name> \
  [--parameter <name>] --claim <text> --code <path[:line]>
litmo check
litmo diff
litmo explain <receipt-id>
```

All commands accept `--root <repo>`. `record` requires an initialized `.litmo/evidence.lock` and resolves the dependency from the consuming project's actual `package.json`.

## Record the included example

The repository includes one committed receipt for the local fixture package:

```bash
node dist/src/cli.js check
node dist/src/cli.js explain sha256:9bfbb065cff372abe52e8e269123959e9f2ae84cd02230dc751f768ac5e4c274
```

To create a new receipt:

```bash
node dist/src/cli.js record \
  --project examples/signature-drift/app \
  --package @litmo/demo-contract \
  --symbol parseConfig \
  --parameter options \
  --claim "parseConfig accepts an optional options parameter used by the demo." \
  --code examples/signature-drift/app/src/index.ts:3
```

## Coding-agent setup

Run `npm run build`, run `litmo init` in the target repository, then configure the local STDIO server. Minimal, official-format examples for [Codex, Claude Code, and Cursor](docs/mcp.md) are included.

The MCP surface exposes `litmo_record`. It accepts a claim and evidence locator, then calls the same core used by the CLI. It does not accept raw Receipt JSON and cannot store `matched` or `verified` assertions.

## Trust model

`.litmo/receipts/*.json` is untrusted input. During every check, Litmo:

1. Strictly validates the lock and receipt schemas.
2. Derives receipt file paths only from full SHA-256 IDs.
3. Recomputes the receipt content hash and expected signature hash.
4. Resolves the installed dependency without executing package code or shell commands.
5. Recomputes the TypeScript signature and classifies integrity, source drift, semantic support, and runtime correctness separately.

Content hashes validate internal consistency, not authorship. Review changes to both `.litmo/evidence.lock` and `.litmo/receipts/` in Git; v0.1 does not sign Receipts.

See [Architecture](docs/architecture.md) for the boundary details and exit policy.

## Development

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run check
```

`npm run verify` runs the same complete gate as GitHub Actions. Tests use temporary local fixtures and require no API keys, paid services, network calls, or Litmo backend.

## Status

v0.1 intentionally excludes web UI, browser extensions, cloud accounts, RAG, arbitrary web semantics, LLM-as-a-judge gates, arbitrary command receipts, auto-fix, signing services, and npm publication. See [CHANGELOG.md](CHANGELOG.md).

## License

[Mozilla Public License 2.0](LICENSE).
