# ReproMin runnable example

This fixture demonstrates a real JSON reduction against a disposable local HTTP service.
It needs only Node.js 22 or newer.

Terminal 1:

```bash
node examples/repro-min/server.mjs
```

Terminal 2:

```bash
npm run build
node dist/src/cli.js minimize \
  --request examples/repro-min/failing-request.json \
  --status 500 \
  --response-pointer /error/code \
  --response-equals '"INVALID_FILTER"' \
  --output examples/repro-min/minimal-repro.json \
  --confirm-replay yes
```

The original body contains query, region, date, pagination, retry, and trace data. The server
fails only when `/filters/unsupported/mode` equals `"explode"`. Evidrift replays every
candidate and produces:

```json
{
  "filters": {
    "unsupported": {
      "mode": "explode"
    }
  }
}
```

Replay the content-addressed artifact once:

```bash
node dist/src/cli.js reproduce \
  --artifact examples/repro-min/minimal-repro.json \
  --confirm-replay yes
```

`minimal-repro.json` is intentionally gitignored because its loopback port is a local fixture
detail. The zero-configuration `evidrift repro-demo` command exercises the same workflow
without leaving a server running.
