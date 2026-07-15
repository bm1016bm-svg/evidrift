# User acceptance test report

This report tests the Evidrift v0.2 source tree as a user would use it: through the CLI, through a real STDIO MCP client, and against temporary repositories with installed local fixture packages.

The acceptance target is narrow: Evidrift must record one deterministic TypeScript dependency assumption, detect signature drift, reject inconsistent evidence, and explain the result without executing untrusted package code.

## Reproduce

```bash
npm ci --ignore-scripts
npm run verify
npm run uat
```

`npm run verify` runs formatting, lint, typecheck, all automated tests, the end-to-end smoke test, and a check of this repository's committed Receipt. `npm run uat` isolates the user-facing acceptance cases.

Local v0.2 overload checkpoint on 2026-07-15:

- Platform: Windows, Node.js `v24.13.0`, npm `11.6.2`.
- Automated result: 42 tests passed, 0 failed, 0 skipped.
- Isolated UAT result: 16 tests passed, 0 failed, 0 skipped; smoke passed after the same run.
- Smoke result: baseline `PASS`, changed signature `FAIL`.
- v0.2 packed-install result: a fresh temporary consumer installed the tarball, returned `0.2.0`, exposed `--overload <number>` in `--help`, and contained the `evidrift-mcp` executable.
- v0.2 local-tarball npx result: a separate empty directory ran `evidrift --version` through `npx --yes --package <local-tarball>` and returned `0.2.0`.
- v0.2 local pack result: 55 files, a 42,574-byte tarball, and 184,979 unpacked bytes. This is a local release-candidate artifact, not a registry publication.
- Registry result: the official npm registry returned `evidrift@0.1.0` with the `latest` tag, SHA-1 `a215f50a8f7cb29c23122a2db6d9bdfcd24b74e9`, and the expected SHA-512 integrity on 2026-07-15.
- v0.1 publish result: the public npm package contains 55 files, a 40,984-byte tarball, and 176,248 unpacked bytes. The authenticated dry-run and final registry artifact reported the same SHA-1.
- Public npx result: a clean consumer outside this repository ran `npx --yes evidrift init` and `npx --yes evidrift demo` from a fresh cache; initialization created the lock and the demo reproduced deterministic PASS-to-FAIL drift.
- v0.2 publication result: not published. The public `latest` tag remains v0.1.0 until the v0.2 release gate and explicit publication step are complete.
- Dependency advisory result: `npm audit --registry=https://registry.npmjs.org` reported 0 known vulnerabilities at the checkpoint time.
- GitHub Actions runs the same release gate on Node.js 22 and 24; the README CI badge reports the current `main` result.

The test counts above come from local `npm run verify` and `npm run uat` output. The v0.2 size comes from local `npm pack`; the v0.1 public package sizes and hashes come from npm publish output and a separate official-registry readback. The advisory count comes from npm's official registry response; it is not proof that the code has no vulnerability. These are not coverage percentages and make no claim about production usage.

## Acceptance matrix

| ID     | User or threat action                                          | Expected result                                                                     | Automated evidence                 |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| UAT-01 | Run `init` twice                                               | First call creates storage; second is safe and idempotent                           | `tests/uat.test.ts` lifecycle test |
| UAT-02 | Record an installed symbol and parameter                       | Content-addressed Receipt is written; no verified state is stored                   | lifecycle and core tests           |
| UAT-03 | Check unchanged dependency                                     | `PASS`, exit `0`, claim and affected code shown                                     | lifecycle test                     |
| UAT-04 | Change optional parameter to required                          | `FAIL contract_mismatch`, exit `1`, expected/current signatures and action shown    | lifecycle test and smoke test      |
| UAT-05 | Run `diff` and `explain`                                       | Drift is shown; four trust axes are separated                                       | lifecycle test                     |
| UAT-06 | Change package version but keep signature                      | `WARNING source_changed`, exit `0`                                                  | core test                          |
| UAT-07 | Remove exported symbol                                         | Deterministic blocking mismatch                                                     | core and UAT mismatch tests        |
| UAT-08 | Replace the recorded signature with a nonmatching overload set | Deterministic blocking mismatch with the current candidates                         | UAT mismatch test                  |
| UAT-09 | Put throwing code in package JavaScript                        | Recording succeeds without executing it                                             | core execution-safety test         |
| UAT-10 | Edit one line of a Receipt                                     | `FAIL evidence_integrity`, exit `2`, recovery action shown                          | UAT tamper test                    |
| UAT-11 | Add `matched` or `verified` to a Receipt                       | Strict-schema integrity failure                                                     | core and UAT forged-state tests    |
| UAT-12 | Break Receipt JSON                                             | Classified integrity failure, not a stack trace                                     | UAT malformed-evidence test        |
| UAT-13 | Delete a referenced Receipt                                    | Classified missing-file integrity failure                                           | UAT malformed-evidence test        |
| UAT-14 | Duplicate a lock ID                                            | Classified lock integrity failure                                                   | UAT malformed-evidence test        |
| UAT-15 | Supply an oversized Receipt                                    | Rejected before full read                                                           | core size-limit test               |
| UAT-16 | Replace Receipt directory with a symlink                       | Rejected instead of followed                                                        | core symlink test                  |
| UAT-17 | Use `https://does-not-exist.invalid/...` as package source     | Rejected locally as unsupported URL; no request is sent                             | CLI and MCP UAT tests              |
| UAT-18 | Name a package that is not installed                           | Clear record error; no Receipt written                                              | UAT invalid-input test             |
| UAT-19 | Name a parameter that does not exist                           | Clear record error; no Receipt written                                              | UAT invalid-input test             |
| UAT-20 | Escape the repository with `../`                               | Path rejected                                                                       | UAT invalid-input test             |
| UAT-21 | Point to missing affected code                                 | Record refused with the exact missing path                                          | UAT invalid-input test             |
| UAT-22 | Remove dependency after recording                              | `WARNING unverifiable`, exit `0`, recovery action shown                             | UAT source-warning test            |
| UAT-23 | Corrupt the TypeScript declaration                             | Readable non-blocking warning                                                       | UAT source-warning test            |
| UAT-24 | Record through STDIO MCP                                       | Same core writes the same Receipt format                                            | MCP integration test               |
| UAT-25 | Send raw `verified` through MCP                                | Strict input rejection; lock stays empty                                            | MCP rejection test                 |
| UAT-26 | Build an npm tarball                                           | Executables and license included; source, tests, examples, and `.evidrift` excluded | package test                       |
| UAT-27 | Serialize equal objects in different key order                 | Same canonical SHA-256 content address                                              | canonical test                     |
| UAT-28 | Rewrite Receipt and lock with a newly calculated ID            | Internally valid; must be caught in Git review                                      | coordinated-rehash boundary test   |
| UAT-29 | Inject newline, ANSI, or C1 controls into untrusted text       | Record rejects it; rendered failures escape controls and cannot forge log lines     | text and control-character tests   |
| UAT-30 | Name 1,024 or 1,025 Receipts in the lock                       | New record is refused without an orphan; oversized lock fails before reads          | Receipt-count limit test           |
| UAT-31 | Change spaces inside a TypeScript string-literal type          | Exact literal change is a deterministic mismatch                                    | literal-whitespace core test       |
| UAT-32 | Import declaration types from another repository file          | Repository-local transitive declarations are resolved                               | transitive core test               |
| UAT-33 | Import a declaration outside the repository                    | Revalidation becomes a readable `WARNING unverifiable`; external file is refused    | transitive-boundary UAT test       |
| UAT-34 | Exceed declaration file-count or byte budgets                  | Evidence creation fails with the exact active limit                                 | resource-budget UAT test           |
| UAT-35 | Point demo work paths at an outside directory junction         | Demo refuses cleanup and outside data remains intact                                | demo-cleanup UAT test              |
| UAT-36 | Install the packed artifact in a fresh temporary consumer      | Installed `evidrift` help runs and the `evidrift-mcp` executable exists             | packed-install checkpoint          |
| UAT-37 | Record three overloads using a complex cross-file alias        | Missing selector lists candidates; selector `2` records the numeric contract        | boss-fight UAT test                |
| UAT-38 | Run check in a TTY, pipe, CI, or `NO_COLOR` environment        | Human TTY gets colored icons; machine-oriented output remains stable and ANSI-free  | terminal rendering tests           |
| UAT-39 | Run the self-contained `evidrift demo` command                 | Local evidence passes, signature is changed, mismatch is shown, command exits `0`   | demo-command UAT test              |
| UAT-40 | Execute the packed CLI through real local-tarball `npx`        | `init` creates storage and `demo` reproduces PASS-to-FAIL without a global install  | npx packed-install checkpoint      |
| UAT-41 | Run the authenticated npm publication checkpoint               | `prepublishOnly` passes and the public registry returns the exact artifact hash     | 2026-07-15 release checkpoint      |
| UAT-42 | Place user-owned data at the demo workspace path               | Demo refuses replacement without its exact marker and preserves the data            | unmarked-demo UAT test             |
| UAT-43 | Run bare `npx evidrift` from a clean external consumer         | Public `init` creates storage and `demo` reproduces PASS-to-FAIL drift              | 2026-07-15 public-npx checkpoint   |
| UAT-44 | Reorder or prepend unrelated overload declarations             | Stored signature hash still resolves and check remains `PASS`                       | core and boss-fight tests          |
| UAT-45 | Change or remove only the selected overload                    | Deterministic mismatch shows expected signature and current overload set            | core and boss-fight tests          |
| UAT-46 | Submit zero, unsafe, out-of-range, or more than 64 overloads   | Input or resource limit is refused before a Receipt is written                      | CLI, core, and UAT tests           |

## Tamper behavior

The actual storage path is `.evidrift/receipts/<sha256>.json`, not `.evidrift/receipts.json`.

Changing only the text in one Receipt invalidates its content address. `evidrift check` stops before source revalidation and prints:

```text
FAIL evidence_integrity sha256:...
Message: Receipt content hash mismatch.
Receipt ID: sha256:...
Action: Do not trust or hand-edit this Receipt. Restore it from version control, or intentionally create a new Receipt with `evidrift record`.

Summary: 0 pass, 0 warning, 1 fail
```

The CLI uses plain text and emits no ANSI color/control sequences in this case. That keeps the output readable in CI logs and usable as agent context.

Stored claims and paths reject control characters. Rendered fallback errors escape any untrusted newline, ANSI escape, or C1 control, so the output cannot add a fake `PASS` or `FAIL` line.

## Invalid URL behavior

v0.2 has no web or quote adapter. A URL cannot be recorded as a `typescript.symbol` package:

```text
ERROR: Package must be a registry-style npm package name, not a path or URL.
```

Validation happens before dependency resolution. Evidrift does not fetch the URL. A missing registry-style package gets a separate error naming the unresolved dependency.

## Business value supported by these tests

The tests support four concrete claims:

1. A dependency call signature can change without an application-file diff, and Evidrift can block that merge with the old and new signatures side by side.
2. A coding agent can record evidence through MCP but cannot submit a raw Receipt or mark its own work verified.
3. A casual or accidental Receipt edit becomes a classified CI failure instead of silently changing the recorded reason.
4. Revalidation needs no Evidrift account, API key, paid service, network call, package JavaScript execution, or LLM judgment.

No customer, revenue, time-saving, defect-reduction, or performance claim has been inferred from these tests. Those would require real usage data.

## Residual risks and non-guarantees

- Content addressing is not signing. An actor who can replace both the Receipt and lock with newly hashed content can create internally valid evidence. Protect `main`, require review of `.evidrift/**`, and inspect lock diffs.
- `WARNING unverifiable` exits `0` in v0.2. CI detects missing or unreadable source but does not block it by default.
- Overloads require an explicit 1-based selector during record. Evidrift does not yet infer the selected overload from the affected call expression.
- The selector index is not stored. Revalidation searches the current overload set by the stored signature hash, so reordering is stable while changing the selected contract blocks.
- Changes hidden inside named interface/type declarations may not change the rendered signature because deep structural alias expansion is not implemented.
- A repository can reference at most 1,024 Receipts. TypeScript inspection accepts at most 256 repository source files, 2 MiB each, and 16 MiB in aggregate.
- A symbol can expose at most 64 call signatures before candidate rendering is refused.
- Transitive declaration imports outside the repository are refused. This is reported as non-blocking `WARNING unverifiable` under the v0.2 policy.
- Free-text claims are stored for humans; Evidrift does not semantically prove them.
- Runtime correctness, dependency security, web content, arbitrary commands, and multi-process write locking are outside v0.2.
- Passing tests demonstrates the covered deterministic behavior on the tested environment. It is not proof that the software has no defects.
