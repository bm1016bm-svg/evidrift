# Boss fight test

This fixture combines two common TypeScript cases:

- `bossFight` exposes three overload signatures.
- Every overload imports a generic, nested `BossFightOptions` alias from `interfaces.ts`.
- `reordered.d.ts` contains the same contracts in a different declaration order.
- `drifted.d.ts` changes only the numeric overload's supported radix values.

Run the actual CLI acceptance test from the repository root:

```bash
npm run build
node --test --test-name-pattern "boss-fight" dist/tests/uat.test.js
```

The test installs these declarations in a temporary local fixture package. Recording without a selector fails safely and lists the normalized candidates:

```text
ERROR: Symbol bossFight has 3 overloads. Rerun with --overload <1-3>. Candidates: ...
```

The command exits `2`, writes no Receipt, and leaves `evidence.lock` empty. Recording again with `--overload 2` selects the numeric signature:

```text
bossFight(input:number,options:BossFightOptions<{ radix:2|8|10|16; }>):NumericVictory
```

The Receipt stores that normalized signature and its hash, not the numeric selector. Replacing `index.d.ts` with `reordered.d.ts` therefore still passes. Replacing it with `drifted.d.ts` removes the selected hash and produces deterministic `FAIL contract_mismatch` with the expected signature and current overload set.

The adapter does not yet infer the correct overload from the affected call expression, and it does not deep-expand every named alias into a structural contract. An agent or developer must choose one numbered candidate explicitly during record.
