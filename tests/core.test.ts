import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { checkExitCode, checkRepository, initLitmo, recordEvidence } from '../src/core.js';
import { changeFixtureVersion, createFixtureRepository, DRIFTED_DECLARATION } from './helpers.js';

async function recordFixture() {
  const fixture = await createFixtureRepository();
  await initLitmo(fixture.root);
  const receipt = await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@litmo/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    claim: 'parseConfig accepts an optional options parameter.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });
  return { fixture, receipt };
}

test('records content-addressed evidence and revalidates it', async () => {
  const { fixture, receipt } = await recordFixture();
  assert.match(receipt.id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipt.evidence.package.version, '1.0.0');
  assert.equal(
    receipt.evidence.package.resolvedPath,
    'app/node_modules/@litmo/demo-contract/index.d.ts',
  );
  assert.match(
    receipt.evidence.expectedSignature,
    /parseConfig\(input:string,options\?:ParseOptions\)/,
  );

  const results = await checkRepository(fixture.root);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.status, 'pass');
  assert.equal(checkExitCode(results), 0);
});

test('source identity change alone is a non-blocking warning', async () => {
  const { fixture } = await recordFixture();
  await changeFixtureVersion(fixture.dependency, '1.1.0');
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'source_changed');
  assert.equal(results[0]?.blocking, false);
  assert.equal(checkExitCode(results), 0);
});

test('signature drift is a deterministic blocking mismatch', async () => {
  const { fixture } = await recordFixture();
  await writeFile(path.join(fixture.dependency, 'index.d.ts'), DRIFTED_DECLARATION);
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'contract_mismatch');
  assert.equal(results[0]?.blocking, true);
  assert.equal(checkExitCode(results), 1);
  assert.notEqual(results[0]?.expectedSignature, results[0]?.currentSignature);
});

test('a removed exported symbol is a deterministic blocking mismatch', async () => {
  const { fixture } = await recordFixture();
  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    'export declare function replacement(input: string): string;\n',
  );
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'contract_mismatch');
  assert.match(results[0]?.currentSignature ?? '', /missing exported symbol parseConfig/);
  assert.equal(checkExitCode(results), 1);
});

test('dependency JavaScript is never executed while recording evidence', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(
    path.join(fixture.dependency, 'index.js'),
    "throw new Error('must not execute');\n",
  );
  await initLitmo(fixture.root);
  const receipt = await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@litmo/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    claim: 'The declaration contract is recorded without importing package code.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });
  assert.match(receipt.id, /^sha256:/);
});

test('tampered receipt is rejected before source revalidation', async () => {
  const { fixture, receipt } = await recordFixture();
  const receiptPath = path.join(
    fixture.root,
    '.litmo',
    'receipts',
    `${receipt.id.slice('sha256:'.length)}.json`,
  );
  const tampered = { ...receipt, matched: true, verified: true };
  await writeFile(receiptPath, `${JSON.stringify(tampered)}\n`);
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'integrity_error');
  assert.equal(checkExitCode(results), 2);
});
