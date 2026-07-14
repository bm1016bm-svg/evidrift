import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeOutputText, hasUnsafeControlCharacters } from '../src/text.js';
import { renderResult } from '../src/output.js';

test('unsafe control characters are detected and escaped without ANSI output', () => {
  const input = 'claim\nwith\ttab\u001b[2J\u0085next';
  assert.equal(hasUnsafeControlCharacters(input), true);
  assert.equal(hasUnsafeControlCharacters('ordinary TypeScript signature'), false);
  const escaped = escapeOutputText(input);
  assert.equal(escaped, 'claim\\nwith\\ttab\\u001b[2J\\u0085next');
  assert.doesNotMatch(escaped, /[\u0000-\u001f\u007f-\u009f]/u);
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
