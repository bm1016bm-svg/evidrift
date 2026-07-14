# Signature drift example

This example contains:

- `fixture-package/`: a local package with an optional `parseConfig(..., options?)` parameter.
- `app/`: consuming code at `src/index.ts:3`.
- `drift/`: the changed declaration where `options` becomes required.

Run the complete isolated flow from the repository root:

```bash
npm ci
npm run demo
```

The command leaves the generated scenario at `.litmo-demo/signature-drift` for inspection. Running it again safely recreates only that marked Litmo workspace; it does not modify these tracked fixtures.
