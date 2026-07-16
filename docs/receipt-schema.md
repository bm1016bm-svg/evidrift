# Receipt schema v1

Evidrift stores a small lock file and immutable, content-addressed JSON receipts.

## `evidence.lock`

```json
{
  "receipts": ["sha256:9bfbb065cff372abe52e8e269123959e9f2ae84cd02230dc751f768ac5e4c274"],
  "schemaVersion": 1
}
```

Only full SHA-256 IDs are accepted. The corresponding path is derived as `.evidrift/receipts/<64 hex characters>.json`; a lock entry never supplies a path.

## TypeScript Receipt

The repository's committed example is:

```json
{
  "affectedCode": {
    "line": 3,
    "path": "examples/signature-drift/app/src/index.ts"
  },
  "claim": "parseConfig accepts an optional options parameter used by the demo.",
  "evidence": {
    "adapter": "typescript.symbol",
    "expectedSignature": "parseConfig(input:string,options?:ParseOptions):ParseResult",
    "package": {
      "name": "@evidrift/demo-contract",
      "resolvedPath": "examples/signature-drift/fixture-package/index.d.ts",
      "version": "1.0.0"
    },
    "parameter": "options",
    "projectRoot": "examples/signature-drift/app",
    "signatureHash": "sha256:41e1c8f4cf51f7d78fad53eb7632c6dc2783029e410f74b1c3308e623d6e4246",
    "symbol": "parseConfig"
  },
  "id": "sha256:9bfbb065cff372abe52e8e269123959e9f2ae84cd02230dc751f768ac5e4c274",
  "schemaVersion": 1
}
```

## Hash construction

1. Remove the top-level `id` field.
2. Serialize the remaining payload with Evidrift canonical JSON: object keys sorted recursively, array order preserved, JSON primitives only, and non-finite numbers rejected.
3. Hash the UTF-8 bytes with SHA-256.
4. Prefix the lowercase hexadecimal digest with `sha256:`.

`signatureHash` separately hashes the exact normalized `expectedSignature` UTF-8 string. The Receipt ID covers that signature hash and every other payload field.

## JSON Pointer Receipt

Schema v1 also accepts one deterministic repository-local JSON value:

```json
{
  "affectedCode": {
    "line": 24,
    "path": "src/client.ts"
  },
  "claim": "The generated client calls listUsers.",
  "evidence": {
    "adapter": "json.pointer",
    "expectedValue": "\"listUsers\"",
    "pointer": "/api/operationId",
    "sourceHash": "sha256:cff922fd01c659abea4f56581f62dc757e8900faccab24a2d27c860da7bc1a97",
    "sourcePath": "openapi.json",
    "valueHash": "sha256:19e7365de402b0c1c20551cf219e1694fe5d7c938500dfee8191814113234336"
  },
  "id": "sha256:51a0e99020a7cb7f3980892c51488c2d2fac13d8da21608329d659809c0c6757",
  "schemaVersion": 1
}
```

`expectedValue` is JSON text in Evidrift's canonical serialization. `valueHash` hashes that exact string. `sourceHash` hashes the canonical whole document, allowing `check` to distinguish unrelated source changes from selected-value drift. JSON Pointer escaping follows RFC 6901.

This format is deterministic but is not claimed to implement RFC 8785. Schema v1 rejects all unknown fields rather than treating stored status flags as trustworthy.

Receipt strings and paths use bounded, canonical forms. `evidence.lock` is limited to 1 MiB, each Receipt to 4 MiB, claims to 500 characters, and evidence paths to 4096 characters. Storage files must be regular files rather than symlinks.

Content addressing checks internal consistency, not authorship. Replacing both a Receipt and its lock entry with a newly hashed payload is detectable in Git review but is not prevented cryptographically in v0.3.

## Meaning of fields

- `claim`: human explanation of why the contract matters. Evidrift does not semantically prove it.
- `affectedCode`: review location; it is not executed.
- `projectRoot`, `package`, `symbol`, `parameter`, `expectedSignature`, `signatureHash`: `typescript.symbol` locator, source identity, and selected contract.
- `sourcePath`, `pointer`, `expectedValue`, `valueHash`, `sourceHash`: `json.pointer` locator, selected canonical contract, and whole-document identity.
- `id`: content address of all payload fields.

For an overloaded symbol, Evidrift first tries the affected call at `path:line`; TypeScript's resolved declaration selects the signature. `--overload` or the MCP `overload` input is the explicit fallback. The numeric index is deliberately absent from schema v1 because declaration order is not the contract. Later checks search the current overload set for `signatureHash`, so reordering does not require a new Receipt.
