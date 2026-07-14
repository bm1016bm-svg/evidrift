# Receipt schema v1

Litmo stores a small lock file and immutable, content-addressed JSON receipts.

## `evidence.lock`

```json
{
  "receipts": ["sha256:9bfbb065cff372abe52e8e269123959e9f2ae84cd02230dc751f768ac5e4c274"],
  "schemaVersion": 1
}
```

Only full SHA-256 IDs are accepted. The corresponding path is derived as `.litmo/receipts/<64 hex characters>.json`; a lock entry never supplies a path.

## Receipt

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
      "name": "@litmo/demo-contract",
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
2. Serialize the remaining payload with Litmo canonical JSON: object keys sorted recursively, array order preserved, JSON primitives only, and non-finite numbers rejected.
3. Hash the UTF-8 bytes with SHA-256.
4. Prefix the lowercase hexadecimal digest with `sha256:`.

`signatureHash` separately hashes the exact normalized `expectedSignature` UTF-8 string. The Receipt ID covers that signature hash and every other payload field.

This format is deterministic but is not claimed to implement RFC 8785. Schema v1 rejects all unknown fields rather than treating stored status flags as trustworthy.

Receipt strings and paths use bounded, canonical forms. `evidence.lock` is limited to 1 MiB, each Receipt to 4 MiB, claims to 500 characters, and evidence paths to 4096 characters. Storage files must be regular files rather than symlinks.

Content addressing checks internal consistency, not authorship. Replacing both a Receipt and its lock entry with a newly hashed payload is detectable in Git review but is not prevented cryptographically in v0.1.

## Meaning of fields

- `claim`: human explanation of why the contract matters. Litmo does not semantically prove it.
- `affectedCode`: review location; it is not executed.
- `projectRoot`: consuming package directory, relative to the repository.
- `package`: dependency identity captured during record.
- `symbol` / `parameter`: deterministic TypeScript locator.
- `expectedSignature`: normalized call signature captured during record.
- `signatureHash`: quick integrity and comparison value, always recomputed.
- `id`: content address of all payload fields.
