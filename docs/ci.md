# GitHub Actions

Evidrift should run after the repository's locked dependencies are installed. Store `.evidrift/evidence.lock` and `.evidrift/receipts/` in Git so reviewers can see when an assumption is added or replaced.

## Package script

Install Evidrift as a development dependency and expose a stable command for local development and CI:

```bash
npm install --save-dev evidrift
npx evidrift init
```

```json
{
  "scripts": {
    "evidrift:check": "evidrift check"
  }
}
```

Commit the resulting package lock, package manifest, and `.evidrift/` files.

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
        run: npm run evidrift:check
```

The workflow grants read-only repository access. It installs from the committed npm lockfile, does not execute dependency lifecycle scripts, and pins third-party Actions to complete commit SHAs.

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
