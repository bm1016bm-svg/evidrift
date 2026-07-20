# JSON check report

`evidrift check --format json` writes one versioned JSON document to standard output and keeps the same exit-code policy as the text report.

```json
{
  "schemaVersion": 1,
  "tool": {
    "name": "evidrift",
    "version": "0.3.3"
  },
  "command": "check",
  "exitCode": 0,
  "summary": {
    "pass": 1,
    "warning": 0,
    "fail": 0
  },
  "results": [
    {
      "receiptId": "sha256:...",
      "status": "pass",
      "blocking": false,
      "claim": "parseConfig accepts an optional options parameter.",
      "affectedCode": {
        "path": "src/config.ts",
        "line": 12
      },
      "message": "Deterministic TypeScript signature matches."
    }
  ]
}
```

## Top-level fields

| Field           | Meaning                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| `schemaVersion` | Version of this report contract. A breaking report-shape change increments this integer. |
| `tool`          | Stable tool name and the Evidrift package version that produced the report.              |
| `command`       | Always `check` for schema version 1.                                                     |
| `exitCode`      | The process result: `0` match/warning, `1` contract mismatch, `2` integrity error.       |
| `summary`       | Counts of pass, warning, and fail results.                                               |
| `results`       | Ordered Receipt results using the public `CheckResult` fields.                           |

`source_changed` and `unverifiable` increment `summary.warning`. `contract_mismatch` and `integrity_error` increment `summary.fail`. The original status remains available on each result, so consumers do not need to infer it from the summary.

## Stability and trust boundary

- The report contains no timestamp or absolute repository root. Equal check results serialize identically.
- Result order follows `.evidrift/evidence.lock` order.
- Optional evidence-specific fields are omitted when unavailable; they are not emitted as `null`.
- JSON string escaping prevents a result from writing a raw ANSI escape or forged log line.
- `schemaVersion` describes the report, not the separate Receipt or evidence-lock schemas.
- Consumers should reject unsupported `schemaVersion` values and may ignore new additive fields within a supported version.

Argument errors happen before a check report exists. For example, an unsupported `--format` value exits `2` with the normal escaped `ERROR:` message on standard error.

## CI example

Write the report to an artifact while preserving Evidrift's exit code:

```bash
npx evidrift check --format json > evidrift-report.json
```

The command emits no spinner or color in JSON mode, including when standard output is attached to a TTY.
