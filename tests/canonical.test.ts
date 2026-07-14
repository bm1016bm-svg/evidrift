import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalStringify, contentHash } from '../src/canonical.js';

test('canonical serialization sorts object keys recursively', () => {
  const left = { z: 1, nested: { b: true, a: ['x', 2] } };
  const right = { nested: { a: ['x', 2], b: true }, z: 1 };
  assert.equal(canonicalStringify(left), '{"nested":{"a":["x",2],"b":true},"z":1}');
  assert.equal(contentHash(left), contentHash(right));
  assert.match(contentHash(left), /^sha256:[a-f0-9]{64}$/);
});

test('canonical serialization rejects non-finite values', () => {
  assert.throws(() => canonicalStringify({ value: Number.NaN }), /non-finite/);
});
