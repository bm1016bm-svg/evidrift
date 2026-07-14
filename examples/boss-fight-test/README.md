# Boss fight test

This fixture combines two common TypeScript cases:

- `bossFight` exposes three overload signatures.
- Every overload imports a generic, nested `BossFightOptions` alias from `interfaces.ts`.

Run the actual CLI acceptance test from the repository root:

```bash
npm run build
node --test --test-name-pattern "boss-fight" dist/tests/uat.test.js
```

The test installs these two source files in a temporary local fixture package and runs `litmo record`. v0.1 resolves the repository-local cross-file import, then refuses the overload set:

```text
ERROR: v0.1 supports symbols with exactly one call signature.
```

The command exits `2`. It writes no Receipt and leaves `evidence.lock` empty. This is a classified unsupported-input error, not a crash and not a claim that one overload was selected.

The current adapter also does not deep-expand every named alias into a structural contract. A single-signature function may therefore retain an alias name in its rendered signature instead of locking every nested member.
