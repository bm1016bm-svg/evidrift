import assert from 'node:assert/strict';
import { test } from 'node:test';

import { minimizeJsonValue, ReproductionMismatchError, type JsonValue } from '../src/repro.js';

function objectValue(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

test('minimizes nested JSON objects without changing the failure predicate', async () => {
  const input: JsonValue = {
    trace: 'remove',
    payload: {
      trigger: 'INVALID_WIDGET',
      noise: { retries: [1, 2, 3], verbose: true },
    },
    metadata: ['remove', 'this'],
  };
  const result = await minimizeJsonValue(input, {
    probe: async (candidate) => {
      const payload = objectValue(objectValue(candidate)?.payload);
      return payload?.trigger === 'INVALID_WIDGET';
    },
  });

  assert.deepEqual(result.value, { payload: { trigger: 'INVALID_WIDGET' } });
  assert.ok(result.minimizedBytes < result.originalBytes);
  assert.ok(result.accepted > 0);
  assert.equal(result.exhausted, false);
  assert.deepEqual(input, {
    trace: 'remove',
    payload: {
      trigger: 'INVALID_WIDGET',
      noise: { retries: [1, 2, 3], verbose: true },
    },
    metadata: ['remove', 'this'],
  });
});

test('minimizes arrays in chunks and strings by Unicode code point', async () => {
  const result = await minimizeJsonValue(
    {
      cases: ['noise', 'also-noise', 'prefix-💥-suffix', 'unused'],
    },
    {
      probe: async (candidate) => {
        const cases = objectValue(candidate)?.cases;
        return (
          Array.isArray(cases) &&
          cases.some((item) => typeof item === 'string' && item.includes('💥'))
        );
      },
    },
  );

  assert.deepEqual(result.value, { cases: ['💥'] });
});

test('repeats tree passes until no selected single reduction remains', async () => {
  const result = await minimizeJsonValue(
    { value: 'LONG', gate: true },
    {
      probe: async (candidate) => {
        const record = objectValue(candidate);
        const value = record?.value;
        if (typeof value !== 'string') {
          return false;
        }
        return record?.gate === true ? value.startsWith('L') : value === 'L';
      },
    },
  );

  assert.deepEqual(result.value, { value: 'L' });
  assert.equal(result.exhausted, false);
});

test('caches candidates and stops safely at the probe budget', async () => {
  const seen = new Set<string>();
  const input: JsonValue = { keep: 'yes', one: 1, two: 2 };
  const result = await minimizeJsonValue(input, {
    maxProbes: 1,
    probe: async (candidate) => {
      const serialized = JSON.stringify(candidate);
      assert.equal(seen.has(serialized), false);
      seen.add(serialized);
      return objectValue(candidate)?.keep === 'yes';
    },
  });

  assert.deepEqual(result.value, input);
  assert.equal(result.probes, 1);
  assert.equal(result.exhausted, true);
});

test('refuses to minimize an input that does not reproduce the selected failure', async () => {
  await assert.rejects(
    minimizeJsonValue(
      { healthy: true },
      {
        probe: async () => false,
      },
    ),
    ReproductionMismatchError,
  );
});

test('rejects invalid probe budgets before executing the predicate', async () => {
  let called = false;
  await assert.rejects(
    minimizeJsonValue(
      { value: true },
      {
        maxProbes: 0,
        probe: async () => {
          called = true;
          return true;
        },
      },
    ),
    /maxProbes must be an integer between 1 and 500/u,
  );
  assert.equal(called, false);
});
