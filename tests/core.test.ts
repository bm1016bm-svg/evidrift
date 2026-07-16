import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkExitCode, checkRepository, initEvidrift, recordEvidence } from '../src/core.js';
import type { Receipt, TypeScriptSymbolEvidence } from '../src/types.js';
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

function typescriptEvidence(receipt: Receipt): TypeScriptSymbolEvidence {
  assert.equal(receipt.evidence.adapter, 'typescript.symbol');
  return receipt.evidence as TypeScriptSymbolEvidence;
}

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
  const evidence = typescriptEvidence(receipt);
  assert.match(receipt.id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidence.package.version, '1.0.0');
  assert.equal(
    evidence.package.resolvedPath,
    'app/node_modules/@evidrift/demo-contract/index.d.ts',
  );
  assert.match(evidence.expectedSignature, /parseConfig\(input:string,options\?:ParseOptions\)/);

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
  const evidence = typescriptEvidence(receipt);

  assert.match(evidence.expectedSignature, /parseConfig\(input:number,options:/u);
  assert.match(evidence.expectedSignature, /radix:2\|10/u);
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

test('call-site resolution selects the overload TypeScript actually uses', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(path.join(fixture.dependency, 'index.d.ts'), OVERLOADED_DECLARATION);
  await writeFile(
    path.join(fixture.app, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          paths: {
            '@contract': ['./node_modules/@evidrift/demo-contract/index.d.ts'],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(fixture.app, 'src', 'index.ts'),
    "import { parseConfig as parse } from '@contract';\nparse(42, { radix: 10 });\n",
  );
  await initEvidrift(fixture.root);
  const receipt = await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    claim: 'This call relies on the numeric radix overload.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });
  const evidence = typescriptEvidence(receipt);
  assert.match(evidence.expectedSignature, /parseConfig\(input:number,options:/u);
  assert.match(evidence.expectedSignature, /radix:2\|10/u);

  await writeFile(path.join(fixture.dependency, 'index.d.ts'), REORDERED_OVERLOADED_DECLARATION);
  assert.equal((await checkRepository(fixture.root))[0]?.status, 'pass');

  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    REORDERED_OVERLOADED_DECLARATION.replace('radix: 2 | 10', 'radix: 2 | 8 | 10'),
  );
  assert.equal((await checkRepository(fixture.root))[0]?.status, 'contract_mismatch');
});

test('call-site resolution refuses an invalid or ambiguous TypeScript call', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(path.join(fixture.dependency, 'index.d.ts'), OVERLOADED_DECLARATION);
  await initEvidrift(fixture.root);
  await assert.rejects(
    recordEvidence({
      repoRoot: fixture.root,
      projectRoot: fixture.app,
      packageName: '@evidrift/demo-contract',
      symbol: 'parseConfig',
      claim: 'An invalid call must not be guessed.',
      affectedCode: { path: 'app/src/index.ts', line: 2 },
    }),
    /TypeScript cannot resolve the affected call: No overload matches this call/u,
  );

  await writeFile(
    path.join(fixture.app, 'src', 'index.ts'),
    "import { parseConfig } from '@evidrift/demo-contract';\nparseConfig('x', { format: 'text' }); parseConfig(42, { radix: 10 });\n",
  );
  await assert.rejects(
    recordEvidence({
      repoRoot: fixture.root,
      projectRoot: fixture.app,
      packageName: '@evidrift/demo-contract',
      symbol: 'parseConfig',
      claim: 'Two different calls on one line must not be conflated.',
      affectedCode: { path: 'app/src/index.ts', line: 2 },
    }),
    /Multiple calls to parseConfig.*different overloads/u,
  );
});

test('a v0.1-style single-signature receipt survives an unrelated overload addition', async () => {
  const { fixture, receipt } = await recordFixture();
  const evidence = typescriptEvidence(receipt);
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
  assert.equal(results[0]?.currentSignature, evidence.expectedSignature);
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
    affectedCode: { path: 'app/src/index.ts' },
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

test('JSON Pointer evidence passes, warns on unrelated edits, and blocks value drift', async () => {
  const fixture = await createFixtureRepository();
  const jsonPath = path.join(fixture.app, 'openapi.json');
  const document = {
    openapi: '3.1.0',
    info: { title: 'Demo', version: '1.0.0' },
    components: { schemas: { User: { type: 'object', required: ['id'] } } },
  };
  await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
  await initEvidrift(fixture.root);
  const receipt = await recordEvidence({
    repoRoot: fixture.root,
    jsonPath: 'app/openapi.json',
    pointer: '/components/schemas/User/required/0',
    claim: 'User responses require the id field.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });
  assert.equal(receipt.evidence.adapter, 'json.pointer');
  if (receipt.evidence.adapter !== 'json.pointer') {
    assert.fail('Expected JSON Pointer evidence.');
  }
  assert.equal(receipt.evidence.expectedValue, '"id"');
  assert.equal((await checkRepository(fixture.root))[0]?.status, 'pass');

  document.info.title = 'Renamed demo';
  await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
  const sourceChanged = await checkRepository(fixture.root);
  assert.equal(sourceChanged[0]?.status, 'source_changed');
  assert.equal(sourceChanged[0]?.blocking, false);

  document.components.schemas.User.required[0] = 'userId';
  await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
  const drift = await checkRepository(fixture.root);
  assert.equal(drift[0]?.status, 'contract_mismatch');
  assert.equal(drift[0]?.expectedJsonValue, '"id"');
  assert.equal(drift[0]?.currentJsonValue, '"userId"');
  assert.equal(checkExitCode(drift), 1);
});

test('JSON Pointer removal is a deterministic mismatch and invalid JSON is a warning', async () => {
  const fixture = await createFixtureRepository();
  const jsonPath = path.join(fixture.app, 'contract.json');
  await writeFile(jsonPath, '{"contract":{"enabled":true}}\n');
  await initEvidrift(fixture.root);
  await recordEvidence({
    repoRoot: fixture.root,
    jsonPath: 'app/contract.json',
    pointer: '/contract/enabled',
    claim: 'The contract remains enabled.',
    affectedCode: { path: 'app/src/index.ts' },
  });

  await writeFile(jsonPath, '{"contract":{}}\n');
  const missing = await checkRepository(fixture.root);
  assert.equal(missing[0]?.status, 'contract_mismatch');
  assert.match(missing[0]?.currentJsonValue ?? '', /missing JSON Pointer/u);

  await writeFile(jsonPath, '{not-json}\n');
  const invalid = await checkRepository(fixture.root);
  assert.equal(invalid[0]?.status, 'unverifiable');
  assert.equal(invalid[0]?.blocking, false);
  assert.match(invalid[0]?.message ?? '', /not valid JSON/u);
});

test('hand-edited JSON Pointer evidence fails integrity before source access', async () => {
  const fixture = await createFixtureRepository();
  await writeFile(path.join(fixture.app, 'contract.json'), '{"value":"expected"}\n');
  await initEvidrift(fixture.root);
  const receipt = await recordEvidence({
    repoRoot: fixture.root,
    jsonPath: 'app/contract.json',
    pointer: '/value',
    claim: 'The exact JSON value is required.',
    affectedCode: { path: 'app/src/index.ts' },
  });
  const file = path.join(
    fixture.root,
    '.evidrift',
    'receipts',
    `${receipt.id.slice('sha256:'.length)}.json`,
  );
  const tampered = JSON.parse(await readFile(file, 'utf8')) as {
    evidence: { expectedValue: string };
  };
  tampered.evidence.expectedValue = '"tampered"';
  await writeFile(file, `${JSON.stringify(tampered)}\n`);
  const results = await checkRepository(fixture.root);
  assert.equal(results[0]?.status, 'integrity_error');
  assert.match(results[0]?.message ?? '', /valueHash does not match expectedValue/u);
  assert.equal(checkExitCode(results), 2);
});

test('JSON Pointer evidence refuses a linked source outside the repository', async (t) => {
  const fixture = await createFixtureRepository();
  const outside = await mkdtemp(path.join(tmpdir(), 'evidrift-json-outside-'));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  const outsideFile = path.join(outside, 'contract.json');
  const linked = path.join(fixture.app, 'linked-source');
  await writeFile(outsideFile, '{"value":true}\n');
  try {
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
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
  await initEvidrift(fixture.root);
  await assert.rejects(
    recordEvidence({
      repoRoot: fixture.root,
      jsonPath: 'app/linked-source/contract.json',
      pointer: '/value',
      claim: 'JSON evidence must stay inside the repository.',
      affectedCode: { path: 'app/src/index.ts' },
    }),
    /resolves outside the repository/u,
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
