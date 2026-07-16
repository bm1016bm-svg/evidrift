import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkExitCode, checkRepository, initEvidrift, recordEvidence } from '../src/core.js';
import { changeFixtureVersion, createFixtureRepository, DRIFTED_DECLARATION } from './helpers.js';

const OVERLOADED_DECLARATION = [
  "export declare function parseConfig(input: string, options?: { format: 'text' }): string;",
  'export declare function parseConfig(input: number, options: { radix: 2 | 10 }): number;',
  'export declare function parseConfig(input: Uint8Array, options?: { copy: boolean }): Uint8Array;',
  '',
].join('\n');

const REORDERED_OVERLOADED_DECLARATION = [
  'export declare function parseConfig(input: Uint8Array, options?: { copy: boolean }): Uint8Array;',
  "export declare function parseConfig(input: string, options?: { format: 'text' }): string;",
  'export declare function parseConfig(input: number, options: { radix: 2 | 10 }): number;',
  '',
].join('\n');

async function recordFixture() {
  const fixture = await createFixtureRepository();
  await initEvidrift(fixture.root);
  const receipt = await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
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
    'app/node_modules/@evidrift/demo-contract/index.d.ts',
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

test('selected overload is content-addressed and survives declaration reordering', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(path.join(fixture.dependency, 'index.d.ts'), OVERLOADED_DECLARATION);
  await initEvidrift(fixture.root);
  const receipt = await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    overload: 2,
    claim: 'The numeric overload accepts radix options.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });

  assert.match(receipt.evidence.expectedSignature, /parseConfig\(input:number,options:/u);
  assert.match(receipt.evidence.expectedSignature, /radix:2\|10/u);
  assert.equal('overload' in receipt.evidence, false);
  assert.equal((await checkRepository(fixture.root))[0]?.status, 'pass');

  await writeFile(path.join(fixture.dependency, 'index.d.ts'), REORDERED_OVERLOADED_DECLARATION);
  assert.equal((await checkRepository(fixture.root))[0]?.status, 'pass');

  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    `export declare function parseConfig(input: boolean): boolean;\n${REORDERED_OVERLOADED_DECLARATION}`,
  );
  assert.equal((await checkRepository(fixture.root))[0]?.status, 'pass');
});

test('a v0.1-style single-signature receipt survives an unrelated overload addition', async () => {
  const { fixture, receipt } = await recordFixture();
  assert.equal('overload' in receipt.evidence, false);
  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    [
      'export interface ParseOptions { strict?: boolean; }',
      'export interface ParseResult { value: string; }',
      'export declare function parseConfig(input: number): ParseResult;',
      'export declare function parseConfig(input: string, options?: ParseOptions): ParseResult;',
      '',
    ].join('\n'),
  );

  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'pass');
  assert.equal(results[0]?.currentSignature, receipt.evidence.expectedSignature);
});

test('selected overload drift is a deterministic blocking mismatch', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(path.join(fixture.dependency, 'index.d.ts'), OVERLOADED_DECLARATION);
  await initEvidrift(fixture.root);
  await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    overload: 2,
    claim: 'The numeric overload accepts binary or decimal radix options.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });

  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    OVERLOADED_DECLARATION.replace('radix: 2 | 10', 'radix: 2 | 8 | 10'),
  );
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'contract_mismatch');
  assert.equal(results[0]?.blocking, true);
  assert.match(results[0]?.expectedSignature ?? '', /radix:2\|10/u);
  assert.match(results[0]?.currentSignature ?? '', /<overloads:/u);
  assert.match(results[0]?.currentSignature ?? '', /radix:2\|8\|10/u);
  assert.equal(checkExitCode(results), 1);
});

test('overload recording requires an in-range selector for the chosen parameter contract', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(path.join(fixture.dependency, 'index.d.ts'), OVERLOADED_DECLARATION);
  await initEvidrift(fixture.root);
  const base = {
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    claim: 'An overload must be selected explicitly.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  } as const;

  await assert.rejects(recordEvidence(base), /has 3 overloads.*--overload <1-3>.*Candidates:/u);
  await assert.rejects(
    recordEvidence({ ...base, overload: 4 }),
    /Overload selector 4 is out of range.*expected 1-3/u,
  );

  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    [
      'export declare function parseConfig(input: string): string;',
      'export declare function parseConfig(input: number, options: object): number;',
      '',
    ].join('\n'),
  );
  await assert.rejects(
    recordEvidence({ ...base, overload: 1 }),
    /Parameter options was not found on parseConfig/u,
  );
});

test('overload sets are resource-bounded before candidate rendering', async () => {
  const fixture = await createFixtureRepository();
  const declarations = Array.from(
    { length: 65 },
    (_, index) =>
      `export declare function parseConfig(input: ${JSON.stringify(`case-${index}`)}): ${index};`,
  );
  await writeFile(path.join(fixture.dependency, 'index.d.ts'), `${declarations.join('\n')}\n`);
  await initEvidrift(fixture.root);

  await assert.rejects(
    recordEvidence({
      repoRoot: fixture.root,
      projectRoot: fixture.app,
      packageName: '@evidrift/demo-contract',
      symbol: 'parseConfig',
      overload: 1,
      claim: 'Oversized overload sets are refused.',
      affectedCode: { path: 'app/src/index.ts', line: 2 },
    }),
    /more than 64 call signatures/u,
  );
});

test('distinct string-literal whitespace produces a deterministic mismatch', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    'export declare function parseConfig(mode: "a b"): void;\n',
  );
  await initEvidrift(fixture.root);
  await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
    symbol: 'parseConfig',
    parameter: 'mode',
    claim: 'The exact string-literal mode is part of the dependency contract.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });

  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    'export declare function parseConfig(mode: "a  b"): void;\n',
  );
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'contract_mismatch');
  assert.match(results[0]?.expectedSignature ?? '', /"a b"/);
  assert.match(results[0]?.currentSignature ?? '', /"a  b"/);
  assert.equal(checkExitCode(results), 1);
});

test('transitive declarations inside the repository remain supported', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(
    path.join(fixture.dependency, 'options.d.ts'),
    'export interface ParseOptions { strict?: boolean; }\n',
  );
  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    [
      "import type { ParseOptions } from './options.js';",
      'export declare function parseConfig(input: string, options?: ParseOptions): string;',
      '',
    ].join('\n'),
  );

  await initEvidrift(fixture.root);
  await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    claim: 'Repository-confined transitive declarations remain usable.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'pass');
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
  await initEvidrift(fixture.root);
  const receipt = await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
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
    '.evidrift',
    'receipts',
    `${receipt.id.slice('sha256:'.length)}.json`,
  );
  const tampered = { ...receipt, matched: true, verified: true };
  await writeFile(receiptPath, `${JSON.stringify(tampered)}\n`);
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'integrity_error');
  assert.equal(checkExitCode(results), 2);
});

test('oversized untrusted receipt is rejected before it is read', async () => {
  const { fixture, receipt } = await recordFixture();
  const receiptPath = path.join(
    fixture.root,
    '.evidrift',
    'receipts',
    `${receipt.id.slice('sha256:'.length)}.json`,
  );
  await writeFile(receiptPath, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'integrity_error');
  assert.match(results[0]?.message ?? '', /exceeds the 4194304-byte limit/);
  assert.equal(checkExitCode(results), 2);
});

test('receipt directory symlink is rejected instead of following untrusted storage', async (t) => {
  const { fixture, receipt } = await recordFixture();
  const receiptsPath = path.join(fixture.root, '.evidrift', 'receipts');
  const outside = await mkdtemp(path.join(tmpdir(), 'evidrift-outside-'));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  const outsideReceipt = path.join(outside, `${receipt.id.slice('sha256:'.length)}.json`);
  await writeFile(outsideReceipt, `${JSON.stringify(receipt)}\n`);
  await rm(receiptsPath, { recursive: true });
  try {
    await symlink(outside, receiptsPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'EPERM'
    ) {
      t.skip('The current Windows account cannot create symlinks.');
      return;
    }
    throw error;
  }

  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'integrity_error');
  assert.match(results[0]?.message ?? '', /.evidrift\/receipts must be a real directory/);
  assert.equal(checkExitCode(results), 2);
});
