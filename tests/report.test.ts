import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHECK_REPORT_SCHEMA_VERSION,
  createCheckReport,
  renderCheckReport,
} from '../src/report.js';
import { EVIDRIFT_VERSION, type CheckResult } from '../src/types.js';

const results: CheckResult[] = [
  {
    receiptId: 'sha256:pass',
    status: 'pass',
    blocking: false,
    message: 'Contract matches.',
  },
  {
    receiptId: 'sha256:source',
    status: 'source_changed',
    blocking: false,
    message: 'Source changed.',
  },
  {
    receiptId: 'sha256:unverifiable',
    status: 'unverifiable',
    blocking: false,
    message: 'Source unavailable.',
  },
  {
    receiptId: 'sha256:mismatch',
    status: 'contract_mismatch',
    blocking: true,
    affectedCode: { path: 'src/example.ts', line: 7 },
    message: 'Contract changed.',
  },
  {
    receiptId: 'sha256:integrity',
    status: 'integrity_error',
    blocking: true,
    message: 'Unsafe terminal text\u001b[2J is JSON-escaped.',
  },
];

test('check report exposes a versioned deterministic integration contract', () => {
  const report = createCheckReport(results);
  assert.equal(report.schemaVersion, CHECK_REPORT_SCHEMA_VERSION);
  assert.deepEqual(report.tool, { name: 'evidrift', version: EVIDRIFT_VERSION });
  assert.equal(report.command, 'check');
  assert.equal(report.exitCode, 2);
  assert.deepEqual(report.summary, { pass: 1, warning: 2, fail: 2 });
  assert.deepEqual(report.results, results);
  assert.equal('generatedAt' in report, false);
  assert.equal('repoRoot' in report, false);
});

test('rendered check report is stable valid JSON without raw terminal controls', () => {
  const rendered = renderCheckReport(results);
  assert.equal(rendered, renderCheckReport(results));
  assert.deepEqual(JSON.parse(rendered), createCheckReport(results));
  assert.match(rendered, /\\u001b/u);
  assert.doesNotMatch(rendered, /\u001b/u);
});
