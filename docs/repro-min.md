# ReproMin: replay-verified HTTP request reduction

ReproMin is Evidrift's failure-minimization workflow. It repeatedly removes JSON structure,
replays each candidate against an explicit loopback HTTP target, and keeps a reduction only
when the selected failure predicate still matches.

It is built for one narrow job: turn a large failing JSON request into a small, reviewable
reproduction without asking an LLM to decide whether two failures look similar.

## See it without configuring a server

Requires Node.js 22 or newer:

```bash
npx --yes evidrift@latest repro-demo
```

The demo starts a disposable server on `127.0.0.1`, verifies an `INVALID_FILTER` failure,
reduces the request, verifies the result again, and closes the server. It contacts no remote
host and writes no project files.

## Minimize your own local failure

Save the request as `failing-request.json`:

```json
{
  "schemaVersion": 1,
  "url": "http://127.0.0.1:3000/api/search",
  "method": "POST",
  "headers": {
    "content-type": "application/json"
  },
  "body": {
    "query": "quarterly report",
    "filters": {
      "unsupported": {
        "mode": "explode"
      },
      "irrelevant": [1, 2, 3]
    }
  }
}
```

Select both the HTTP status and an error identity:

```bash
npx evidrift minimize \
  --request failing-request.json \
  --status 500 \
  --response-pointer /error/code \
  --response-equals '"INVALID_FILTER"' \
  --output minimal-repro.json \
  --confirm-replay yes
```

For a plain-text response, replace the pointer options with:

```bash
--response-contains "Invalid filter"
```

`--status` alone is deliberately insufficient. Two unrelated bugs can both return HTTP 500.

The output is a content-addressed JSON artifact containing the minimized request, predicate,
input and result hashes, byte counts, probe count, and the exact scope of the minimality
claim. Raw response bodies are not stored.

The artifact is an internally consistent record, not an authenticated transcript. Anyone who
rewrites its fields can recompute its content hash. Use `reproduce` to verify one current replay,
and review the fixture before sharing it.

Replay the artifact once:

```bash
npx evidrift reproduce \
  --artifact minimal-repro.json \
  --confirm-replay yes
```

## What "minimal" means

When the probe budget is not exhausted, Evidrift reports:

> 1-minimal under the selected JSON reducers and failure predicate.

The selected reducers remove object properties, array chunks, and string characters, then
simplify numeric values. The reducer repeats passes until no selected single reduction still
matches. This is not a claim of the globally smallest possible request.

If the probe budget is exhausted, the artifact instead says that it contains the smallest
verified candidate found before the budget ended.

## Safety boundary

ReproMin replays requests, so it is intentionally isolated from `evidrift check`, Receipts,
and the MCP tools.

The first release:

- accepts only literal `127.0.0.0/8` or `::1` HTTP targets;
- never follows redirects or uses proxy configuration;
- supports JSON bodies with `POST`, `PUT`, or `PATCH`;
- requires `--confirm-replay yes`;
- rejects credentials, cookies, common secret-shaped names, high-confidence token patterns, and hop-by-hop headers;
- runs probes sequentially with a default total budget of 100, including final verification;
- defaults to a 5-second wall-clock timeout per probe;
- caps a fixture or serialized body at 1 MiB and inspected response data at 64 KiB;
- caps JSON at 10,000 nodes and 64 levels;
- writes output only to a new repository-confined regular file; and
- stores no telemetry or response body.

The available design ranges are `--max-probes 2..500` and `--timeout-ms 100..30000`. These
are product limits, not proof that replay is harmless. Use a disposable local fixture.

Secret detection is defense in depth, not a data-loss-prevention guarantee. Use only synthetic
fixture data and inspect the generated artifact before committing or sharing it.

ReproMin does not import cURL yet. Parsing a shell command incorrectly can execute or read
more than the user intended, so cURL support will not be added until it has its own tokenizer,
redaction policy, and injection tests.

The MVP assumes a deterministic disposable fixture. It caches candidate outcomes and does not
yet implement N-of-M flaky reproduction, state reset hooks, compressed responses, duplicate
JSON object-key preservation, or lossless numeric token preservation. If the same request can
change outcomes, do not treat the artifact as stable evidence.

## Failure and exit behavior

| Exit | Meaning                                                                            |
| ---: | ---------------------------------------------------------------------------------- |
|  `0` | The selected failure was minimized or reproduced successfully                      |
|  `1` | The reachable target did not match the selected failure predicate                  |
|  `2` | The input, safety policy, artifact integrity, network probe, or output was invalid |

Candidate timeouts and connection errors are unavailable probes, not evidence that the
application stopped failing.
