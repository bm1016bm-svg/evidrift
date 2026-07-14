# Signature drift example

This example contains:

- `fixture-package/`: a local package with an optional `parseConfig(..., options?)` parameter.
- `app/`: consuming code at `src/index.ts:3`.
- `drift/`: the changed declaration where `options` becomes required.

Run the complete isolated flow from the repository root:

```bash
npm ci
npm run build
npm run demo
```

For manual inspection, use `npm run demo:setup`, then the commands in the root README. `npm run demo:drift` applies the changed declaration only inside ignored `.litmo-demo/`; it does not modify tracked fixtures.
