# JSON Pointer drift

This example locks the OpenAPI operation used by `src/client.ts` without fetching a URL or evaluating the whole schema.

From this directory with Evidrift installed:

```bash
npx evidrift init
npx evidrift record \
  --json openapi.json \
  --pointer /paths/~1users/get/operationId \
  --claim "The client calls listUsers." \
  --code src/client.ts:1
npx evidrift check
```

The first check passes. Change `operationId` in `openapi.json` to `searchUsers` and run `npx evidrift check` again. It exits `1` and reports:

```text
FAIL contract_mismatch sha256:...
Claim: The client calls listUsers.
Expected JSON value: "listUsers"
Current JSON value: "searchUsers"
Affected code location: src/client.ts:1
Action: Review the JSON contract change and affected code, then intentionally record a new receipt.
```

Changing only `info.title` produces `WARNING source_changed` with exit `0`, because the selected pointer value still matches. Missing or invalid JSON is `WARNING unverifiable`; a missing selected pointer is a deterministic mismatch.
