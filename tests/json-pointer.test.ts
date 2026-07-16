import assert from 'node:assert/strict';
import { test } from 'node:test';

import { JsonPointerSyntaxError, readJsonPointer } from '../src/json-pointer.js';

const document = {
  'a/b': { '~key': ['zero', { value: true }] },
  empty: { '': 42 },
};

test('RFC 6901 root, escaped tokens, empty keys, and array indexes resolve exactly', () => {
  assert.equal(readJsonPointer(document, ''), document);
  assert.equal(readJsonPointer(document, '/a~1b/~0key/1/value'), true);
  assert.equal(readJsonPointer(document, '/empty/'), 42);
});

test('malformed escapes, leading-zero indexes, and missing tokens are refused', () => {
  assert.throws(() => readJsonPointer(document, 'a/b'), JsonPointerSyntaxError);
  assert.throws(() => readJsonPointer(document, '/a~2b'), /invalid `~` escape/u);
  assert.throws(() => readJsonPointer(document, '/a~1b/~0key/01'), /not a valid index/u);
  assert.throws(() => readJsonPointer(document, '/missing'), /does not exist/u);
});
