# Evidrift FAQ: minimal reproductions and API contract drift

## What problem does Evidrift solve?

Evidrift solves two evidence problems. ReproMin turns a noisy failing JSON request into a small reproduction by replaying every accepted reduction. Contract Receipts preserve one external TypeScript or OpenAPI assumption and check it again in CI.

## What is a verified minimal reproduction?

It is a smaller JSON request that still matches one explicit HTTP status plus error identity during real replay. When the probe budget completes, ReproMin establishes 1-minimality under its documented reducers and predicate—not a global minimum or root cause.

## What is TypeScript API drift?

TypeScript API drift is a change to a package declaration after consumer code was written. Evidrift asks the consuming project's TypeScript compiler which declared overload a real call resolves to, normalizes that signature, and records its hash. A later change to the selected signature produces `FAIL contract_mismatch`; unrelated overload reordering does not.

## What is OpenAPI contract drift?

Evidrift's `json.pointer` adapter selects one canonical value from a repository-local OpenAPI JSON or JSON Schema file with RFC 6901 JSON Pointer. A change to that selected value fails deterministically. An unrelated document edit produces `WARNING source_changed` when the selected value still matches.

## How is Evidrift different from contract testing?

Contract testing normally exercises provider and consumer behavior. Evidrift's contract workflow does not execute services or dependency code; it locks one explicit assumption that influenced a code location. ReproMin deliberately exercises one disposable loopback failure, but it is a reducer rather than a contract test suite. The tools can be used together.

## How is Evidrift different from RAG or AI code review?

RAG supplies context while an answer is generated. AI code review makes a probabilistic judgment after code is written. Evidrift commits deterministic evidence to the repository and recomputes it later without an LLM judge.

## Which coding agents can use Evidrift?

Any MCP client that can launch a local STDIO server can use Evidrift. The repository includes minimal configurations for Codex, Claude Code, and Cursor. Both MCP tools call the same core used by the CLI.

## Can an agent forge a verified Receipt?

Receipt JSON is treated as untrusted input. `evidrift check` validates schemas, recomputes the Receipt ID and evidence hash, and reloads the source. It never trusts stored `matched` or `verified` fields. Git review and branch protection are still required because an attacker who replaces both a Receipt and the lock can create new internally consistent evidence.

## Does Evidrift fetch URLs or execute commands?

Contract checks do not. TypeScript evidence is read from installed declaration files and JSON evidence from repository-local `.json` files. Receipts cannot trigger shell commands, package imports, network requests, or LLM calls.

`minimize` and `reproduce` are separate CLI-only commands that require explicit confirmation and permit only literal loopback HTTP targets. They reject redirects, common secret-shaped names and token patterns, and remote addresses. That detection is defense in depth rather than a guarantee that a fixture is sanitized. MCP cannot trigger replay.

## What does Evidrift not support yet?

Evidrift v0.4.0 does not support cURL import, remote replay, YAML, remote OpenAPI `$ref`, global-minimum or root-cause claims, semantic equivalence, cloud storage, a Dashboard, automatic repair, or LLM-as-a-judge CI gates.
