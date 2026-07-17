# Evidrift FAQ: TypeScript API and OpenAPI contract drift

## What problem does Evidrift solve?

AI coding agents often write code against an external assumption: a TypeScript overload accepts a particular parameter, or an OpenAPI operation still has a particular identifier. Code review records the implementation, but usually not that assumption. Evidrift stores the deterministic evidence in the repository and checks it again in CI.

## What is TypeScript API drift?

TypeScript API drift is a change to a package declaration after consumer code was written. Evidrift asks the consuming project's TypeScript compiler which declared overload a real call resolves to, normalizes that signature, and records its hash. A later change to the selected signature produces `FAIL contract_mismatch`; unrelated overload reordering does not.

## What is OpenAPI contract drift?

Evidrift's `json.pointer` adapter selects one canonical value from a repository-local OpenAPI JSON or JSON Schema file with RFC 6901 JSON Pointer. A change to that selected value fails deterministically. An unrelated document edit produces `WARNING source_changed` when the selected value still matches.

## How is Evidrift different from contract testing?

Contract testing normally exercises provider and consumer behavior. Evidrift does not execute services or dependency code. It locks one explicit assumption that influenced a code location and revalidates that static contract before merge. The tools can be used together.

## How is Evidrift different from RAG or AI code review?

RAG supplies context while an answer is generated. AI code review makes a probabilistic judgment after code is written. Evidrift commits deterministic evidence to the repository and recomputes it later without an LLM judge.

## Which coding agents can use Evidrift?

Any MCP client that can launch a local STDIO server can use Evidrift. The repository includes minimal configurations for Codex, Claude Code, and Cursor. Both MCP tools call the same core used by the CLI.

## Can an agent forge a verified Receipt?

Receipt JSON is treated as untrusted input. `evidrift check` validates schemas, recomputes the Receipt ID and evidence hash, and reloads the source. It never trusts stored `matched` or `verified` fields. Git review and branch protection are still required because an attacker who replaces both a Receipt and the lock can create new internally consistent evidence.

## Does Evidrift fetch URLs or execute commands?

No. TypeScript evidence is read from installed declaration files, and JSON evidence is read from repository-local `.json` files. Receipts cannot trigger shell commands, package imports, network requests, or LLM calls.

## What does Evidrift not support yet?

The current release does not support YAML, remote URLs, remote OpenAPI `$ref`, runtime correctness, semantic equivalence, cloud storage, a Dashboard, automatic repair, or LLM-as-a-judge CI gates.
