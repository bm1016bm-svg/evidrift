import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeOutputText, hasUnsafeControlCharacters } from '../src/text.js';
import { renderCheck, renderResult } from '../src/output.js';

test('unsafe control characters are detected and escaped without ANSI output', () => {
  const input = 'claim\nwith\ttab\u001b[2J\u0085next';
  assert.equal(hasUnsafeControlCharacters(input), true);
  assert.equal(hasUnsafeControlCharacters('ordinary TypeScript signature'), false);
  const escaped = escapeOutputText(input);
  assert.equal(escaped, 'claim\\nwith\\ttab\\u001b[2J\\u0085next');
  assert.doesNotMatch(escaped, /[\u0000-\u001f\u007f-\u009f]/u);
});

test('interactive check output uses colored status icons while plain output stays stable', () => {
  const results = [
    {
      receiptId: 'sha256:demo',
      status: 'pass' as const,
      blocking: false,
      message: 'Signature matches.',
    },
    {
      receiptId: 'sha256:drift',
      status: 'contract_mismatch' as const,
      blocking: true,
      message: 'Signature changed.',
    },
  ];

  const interactive = renderCheck(results, { interactive: true });
  assert.match(interactive, /✅/u);
  assert.match(interactive, /❌/u);
  assert.match(interactive, /\u001b\[32m/u);
  assert.match(interactive, /\u001b\[31m/u);

  const plain = renderCheck(results);
  assert.match(plain, /^PASS sha256:demo/mu);
  assert.match(plain, /^FAIL contract_mismatch sha256:drift/mu);
  assert.doesNotMatch(plain, /[✅❌\u001b]/u);
});

test('rendered check output cannot inject terminal controls or forged lines', () => {
  const rendered = renderResult({
    receiptId: 'sha256:unsafe\u001b[2J',
    status: 'unverifiable',
    blocking: false,
    message: 'missing source\nFAIL forged\u001b[31m',
    claim: 'line one\r\nline two',
  });

  assert.match(rendered, /Message: missing source\\nFAIL forged\\u001b\[31m/u);
  assert.match(rendered, /Claim: line one\\r\\nline two/u);
  assert.doesNotMatch(rendered, /\u001b/u);
  assert.equal(rendered.split('\n').filter((line) => line.startsWith('FAIL forged')).length, 0);
});
