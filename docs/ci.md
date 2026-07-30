# GitHub Actions

Evidrift should run after the repository's locked dependencies are installed. Store `.evidrift/evidence.lock` and `.evidrift/receipts/` in Git so reviewers can see when an assumption is added or replaced.

This guide covers the network-free contract command, `evidrift check`. ReproMin replay is
CLI-only and intentionally excluded from the default CI path because repeated HTTP requests
can change application state.

The repository also contains a root `action.yml` for GitHub Marketplace publication. A tagged
Action runs the matching immutable npm version from that tag; it does not execute ReproMin.
The Action fetches that package from the official npm registry in the trusted Action directory,
with lifecycle scripts disabled; “network-free” describes the contract check itself, not package
installation. Self-hosted runners must provide Node.js 22 or newer.
When a release containing `action.yml` is available, reference its full commit SHA. Otherwise
use the package workflow below; never reference a development branch from a trusted workflow.

## Package script

Generate the package script and pull-request workflow together:

```bash
npx --yes evidrift@latest init --github-actions
```

The command detects npm, pnpm, or Yarn from `packageManager` and lockfiles. It initializes
`.evidrift/`, adds the following version-pinned script, and creates
`.github/workflows/evidrift.yml`:

```json
{
  "scripts": {
    "evidrift:check": "npx --yes evidrift@0.4.1 check"
  }
}
```

Run the same pinned command locally with:

```bash
npm run evidrift:check
```

Existing `scripts.evidrift:check` and `.github/workflows/evidrift.yml` content is never
overwritten. The initializer reports `preserved` so the owner can merge configuration manually.
Commit the package manifest, workflow, and `.evidrift/` files.

## Complete workflow

```yaml
name: Evidrift

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out repository
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2

      - name: Set up Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 22
          package-manager-cache: false

      - name: Install locked dependencies
        run: npm ci --ignore-scripts

      - name: Revalidate Evidrift receipts
        uses: bm1016bm-svg/evidrift@v0.4.1
        with:
          annotations: github
```

The workflow grants read-only repository access. It installs from the committed npm lockfile, does not execute dependency lifecycle scripts, and pins third-party Actions to complete commit SHAs.

The generated workflow uses the matching Evidrift release tag because the release commit is not
known to the package at generation time. Repositories with stricter supply-chain policy should
replace it with the full commit SHA for that tag.

## Pull-request annotations

The Action enables annotations by default. `contract_mismatch` and `integrity_error` results are
GitHub errors; `source_changed` and `unverifiable` results are warnings. When a Receipt has an
affected code location, the annotation points to that repository-relative file and optional line.

For a custom workflow or local Action test:

```bash
npx evidrift check --annotations github
```

Set the Action input to `annotations: none`, or pass `--annotations none`, to disable workflow
commands. In JSON mode, annotation commands are written to standard error, preserving the
JSON-only standard output contract of `--format json`.

## Result policy

- Exit `0`: every deterministic contract matches, or a source is visibly unavailable or changed without a selected-contract mismatch.
- Exit `1`: a selected TypeScript signature or JSON value changed or disappeared.
- Exit `2`: the lock or a Receipt is malformed, missing, forged, or hash-invalid.

Warnings are intentionally non-blocking. Review them in logs; Evidrift only blocks when it has a deterministic mismatch or integrity failure.

## Machine-readable report

Use the versioned JSON format when another CI step or coding agent needs structured results:

```bash
npx evidrift check --format json > evidrift-report.json
```

The command preserves the normal `0`, `1`, and `2` exit codes, writes only JSON to standard output, and disables interactive progress. See the [JSON check report contract](check-report.md) for the field definitions and compatibility policy.
