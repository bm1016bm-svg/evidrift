# User acceptance test report

This report tests Litmo v0.1 as a user would use it: through the CLI, through a real STDIO MCP client, and against temporary repositories with installed local fixture packages.

The acceptance target is narrow: Litmo must record one deterministic TypeScript dependency assumption, detect signature drift, reject inconsistent evidence, and explain the result without executing untrusted package code.

## Reproduce

```bash
npm ci --ignore-scripts
npm run verify
npm run uat
```

`npm run verify` runs formatting, lint, typecheck, all automated tests, the end-to-end smoke test, and a check of this repository's committed Receipt. `npm run uat` isolates the user-facing acceptance cases.

Local checkpoint on 2026-07-14:

- Platform: Windows, Node.js `v24.13.0`, npm `11.6.2`.
- Automated result: 31 tests passed, 0 failed, 0 skipped.
- Isolated UAT result: 14 tests passed, 0 failed, 0 skipped; smoke passed after the same run.
- Smoke result: baseline `PASS`, changed signature `FAIL`.
- Packed-install result: a fresh temporary consumer installed the tarball, ran the installed `litmo 0.1.0 --help`, and contained the `litmo-mcp` executable.
- Dependency advisory result: `npm audit --registry=https://registry.npmjs.org` reported 0 known vulnerabilities at the checkpoint time.
- GitHub Actions was not run during this checkpoint because publication and push were left to the repository owner. The workflow matrix is configured for Node.js 22 and 24.

The counts above come from the local `npm run verify` and `npm run uat` output. The advisory count comes from npm's official registry response; it is not proof that the code has no vulnerability. These are not coverage percentages and make no claim about production usage.

## Acceptance matrix

| ID     | User or threat action                                      | Expected result                                                                  | Automated evidence                 |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| UAT-01 | Run `init` twice                                           | First call creates storage; second is safe and idempotent                        | `tests/uat.test.ts` lifecycle test |
| UAT-02 | Record an installed symbol and parameter                   | Content-addressed Receipt is written; no verified state is stored                | lifecycle and core tests           |
| UAT-03 | Check unchanged dependency                                 | `PASS`, exit `0`, claim and affected code shown                                  | lifecycle test                     |
| UAT-04 | Change optional parameter to required                      | `FAIL contract_mismatch`, exit `1`, expected/current signatures and action shown | lifecycle test and smoke test      |
| UAT-05 | Run `diff` and `explain`                                   | Drift is shown; four trust axes are separated                                    | lifecycle test                     |
| UAT-06 | Change package version but keep signature                  | `WARNING source_changed`, exit `0`                                               | core test                          |
| UAT-07 | Remove exported symbol                                     | Deterministic blocking mismatch                                                  | core and UAT mismatch tests        |
| UAT-08 | Replace symbol with overload set                           | Deterministic blocking mismatch; v0.1 limit stated                               | UAT mismatch test                  |
| UAT-09 | Put throwing code in package JavaScript                    | Recording succeeds without executing it                                          | core execution-safety test         |
| UAT-10 | Edit one line of a Receipt                                 | `FAIL evidence_integrity`, exit `2`, recovery action shown                       | UAT tamper test                    |
| UAT-11 | Add `matched` or `verified` to a Receipt                   | Strict-schema integrity failure                                                  | core and UAT forged-state tests    |
| UAT-12 | Break Receipt JSON                                         | Classified integrity failure, not a stack trace                                  | UAT malformed-evidence test        |
| UAT-13 | Delete a referenced Receipt                                | Classified missing-file integrity failure                                        | UAT malformed-evidence test        |
| UAT-14 | Duplicate a lock ID                                        | Classified lock integrity failure                                                | UAT malformed-evidence test        |
| UAT-15 | Supply an oversized Receipt                                | Rejected before full read                                                        | core size-limit test               |
| UAT-16 | Replace Receipt directory with a symlink                   | Rejected instead of followed                                                     | core symlink test                  |
| UAT-17 | Use `https://does-not-exist.invalid/...` as package source | Rejected locally as unsupported URL; no request is sent                          | CLI and MCP UAT tests              |
| UAT-18 | Name a package that is not installed                       | Clear record error; no Receipt written                                           | UAT invalid-input test             |
| UAT-19 | Name a parameter that does not exist                       | Clear record error; no Receipt written                                           | UAT invalid-input test             |
| UAT-20 | Escape the repository with `../`                           | Path rejected                                                                    | UAT invalid-input test             |
| UAT-21 | Point to missing affected code                             | Record refused with the exact missing path                                       | UAT invalid-input test             |
| UAT-22 | Remove dependency after recording                          | `WARNING unverifiable`, exit `0`, recovery action shown                          | UAT source-warning test            |
| UAT-23 | Corrupt the TypeScript declaration                         | Readable non-blocking warning                                                    | UAT source-warning test            |
| UAT-24 | Record through STDIO MCP                                   | Same core writes the same Receipt format                                         | MCP integration test               |
| UAT-25 | Send raw `verified` through MCP                            | Strict input rejection; lock stays empty                                         | MCP rejection test                 |
| UAT-26 | Build an npm tarball                                       | Executables and license included; source, tests, examples, and `.litmo` excluded | package test                       |
| UAT-27 | Serialize equal objects in different key order             | Same canonical SHA-256 content address                                           | canonical test                     |
| UAT-28 | Rewrite Receipt and lock with a newly calculated ID        | Internally valid; must be caught in Git review                                   | coordinated-rehash boundary test   |
| UAT-29 | Inject newline, ANSI, or C1 controls into untrusted text   | Record rejects it; rendered failures escape controls and cannot forge log lines  | text and control-character tests   |
| UAT-30 | Name 1,024 or 1,025 Receipts in the lock                   | New record is refused without an orphan; oversized lock fails before reads       | Receipt-count limit test           |
| UAT-31 | Change spaces inside a TypeScript string-literal type      | Exact literal change is a deterministic mismatch                                 | literal-whitespace core test       |
| UAT-32 | Import declaration types from another repository file      | Repository-local transitive declarations are resolved                            | transitive core test               |
| UAT-33 | Import a declaration outside the repository                | Revalidation becomes a readable `WARNING unverifiable`; external file is refused | transitive-boundary UAT test       |
| UAT-34 | Exceed declaration file-count or byte budgets              | Evidence creation fails with the exact active limit                              | resource-budget UAT test           |
| UAT-35 | Point demo work paths at an outside directory junction     | Demo refuses cleanup and outside data remains intact                             | demo-cleanup UAT test              |
| UAT-36 | Install the packed artifact in a fresh temporary consumer  | Installed `litmo` help runs and the `litmo-mcp` executable exists                | packed-install checkpoint          |
| UAT-37 | Record three overloads using a complex cross-file alias    | Cross-file source resolves; record exits `2` clearly and writes no Receipt       | boss-fight UAT test                |

## Tamper behavior

The actual storage path is `.litmo/receipts/<sha256>.json`, not `.litmo/receipts.json`.

Changing only the text in one Receipt invalidates its content address. `litmo check` stops before source revalidation and prints:

```text
FAIL evidence_integrity sha256:...
Message: Receipt content hash mismatch.
Receipt ID: sha256:...
Action: Do not trust or hand-edit this Receipt. Restore it from version control, or intentionally create a new Receipt with `litmo record`.

Summary: 0 pass, 0 warning, 1 fail
```

The CLI uses plain text and emits no ANSI color/control sequences in this case. That keeps the output readable in CI logs and usable as agent context.

Stored claims and paths reject control characters. Rendered fallback errors escape any untrusted newline, ANSI escape, or C1 control, so the output cannot add a fake `PASS` or `FAIL` line.

## Invalid URL behavior

v0.1 has no web or quote adapter. A URL cannot be recorded as a `typescript.symbol` package:

```text
ERROR: Package must be a registry-style npm package name, not a path or URL.
```

Validation happens before dependency resolution. Litmo does not fetch the URL. A missing registry-style package gets a separate error naming the unresolved dependency.

## Business value supported by these tests

The tests support four concrete claims:

1. A dependency call signature can change without an application-file diff, and Litmo can block that merge with the old and new signatures side by side.
2. A coding agent can record evidence through MCP but cannot submit a raw Receipt or mark its own work verified.
3. A casual or accidental Receipt edit becomes a classified CI failure instead of silently changing the recorded reason.
4. Revalidation needs no Litmo account, API key, paid service, network call, package JavaScript execution, or LLM judgment.

No customer, revenue, time-saving, defect-reduction, or performance claim has been inferred from these tests. Those would require real usage data.

## Residual risks and non-guarantees

- Content addressing is not signing. An actor who can replace both the Receipt and lock with newly hashed content can create internally valid evidence. Protect `main`, require review of `.litmo/**`, and inspect lock diffs.
- `WARNING unverifiable` exits `0` in v0.1. CI detects missing or unreadable source but does not block it by default.
- Only a single callable TypeScript signature is checked. Overloads are rejected, and changes hidden inside named interface/type declarations may not change the rendered signature.
- A repository can reference at most 1,024 Receipts. TypeScript inspection accepts at most 256 repository source files, 2 MiB each, and 16 MiB in aggregate.
- Transitive declaration imports outside the repository are refused. This is reported as non-blocking `WARNING unverifiable` under the v0.1 policy.
- Free-text claims are stored for humans; Litmo does not semantically prove them.
- Runtime correctness, dependency security, web content, arbitrary commands, and multi-process write locking are outside v0.1.
- Passing tests demonstrates the covered deterministic behavior on the tested environment. It is not proof that the software has no defects.
