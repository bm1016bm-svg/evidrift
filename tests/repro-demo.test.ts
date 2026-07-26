import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runReproMinDemo } from '../src/repro-demo.js';

test('ReproMin demo reduces and verifies a failure without external services', async () => {
  const artifact = await runReproMinDemo();
  assert.deepEqual(artifact.request.body, {
    filters: { unsupported: { mode: 'explode' } },
  });
  assert.equal(artifact.predicate.status, 500);
  assert.ok(artifact.evidence.minimizedBytes < artifact.evidence.originalBytes);
  assert.equal(artifact.evidence.budgetExhausted, false);
});
