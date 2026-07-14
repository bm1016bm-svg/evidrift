import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import { canonicalStringify, contentHash } from '../src/canonical.js';
import type { EvidenceLock, Receipt, ReceiptPayload } from '../src/types.js';
import { createFixtureRepository, DRIFTED_DECLARATION, type FixtureRepository } from './helpers.js';

const cli = path.resolve(process.cwd(), 'dist', 'src', 'cli.js');
const demoScript = path.resolve(process.cwd(), 'scripts', 'demo.mjs');
const bossFightExample = path.resolve(process.cwd(), 'examples', 'boss-fight-test');

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(arguments_: string[], expectedCode: number): CliResult {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { encoding: 'utf8' });
  assert.equal(result.status, expectedCode, `${result.stdout}\n${result.stderr}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function fixtureFor(t: TestContext): Promise<FixtureRepository> {
  const fixture = await createFixtureRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  return fixture;
}

function recordArguments(
  fixture: FixtureRepository,
  overrides: Partial<Record<'package' | 'symbol' | 'parameter' | 'code' | 'claim', string>> = {},
): string[] {
  return [
    'record',
    '--root',
    fixture.root,
    '--project',
    'app',
    '--package',
    overrides.package ?? '@litmo/demo-contract',
    '--symbol',
    overrides.symbol ?? 'parseConfig',
    '--parameter',
    overrides.parameter ?? 'options',
    '--claim',
    overrides.claim ?? 'parseConfig accepts an optional options parameter.',
    '--code',
    overrides.code ?? 'app/src/index.ts:2',
  ];
}

function receiptIdFrom(output: string): string {
  const match = /Receipt ID: (sha256:[a-f0-9]{64})/.exec(output);
  assert.ok(match?.[1], `Receipt ID not found in output:\n${output}`);
  return match[1];
}

function receiptPath(root: string, id: string): string {
  return path.join(root, '.litmo', 'receipts', `${id.slice('sha256:'.length)}.json`);
}

function fakeReceiptIds(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `sha256:${index.toString(16).padStart(64, '0')}`,
  );
}

async function initializeAndRecord(
  t: TestContext,
): Promise<{ fixture: FixtureRepository; id: string; file: string }> {
  const fixture = await fixtureFor(t);
  runCli(['init', '--root', fixture.root], 0);
  const recorded = runCli(recordArguments(fixture), 0);
  const id = receiptIdFrom(recorded.stdout);
  return { fixture, id, file: receiptPath(fixture.root, id) };
}

test('UAT: init, record, check, diff, explain, and signature drift work end to end', async (t) => {
  const fixture = await fixtureFor(t);
  assert.match(runCli(['init', '--root', fixture.root], 0).stdout, /Initialized/);
  assert.match(runCli(['init', '--root', fixture.root], 0).stdout, /already initialized/);

  const recorded = runCli(recordArguments(fixture), 0);
  const id = receiptIdFrom(recorded.stdout);
  assert.match(recorded.stdout, /State: recorded evidence; no verified/);

  const baseline = runCli(['check', '--root', fixture.root], 0).stdout;
  assert.match(baseline, new RegExp(`PASS ${id}`));
  assert.match(baseline, /Summary: 1 pass, 0 warning, 0 fail/);
  assert.match(runCli(['diff', '--root', fixture.root], 0).stdout, /No evidence drift/);

  const explained = runCli(['explain', id, '--root', fixture.root], 0).stdout;
  for (const axis of [
    'Evidence integrity: valid',
    'Source drift: not observed',
    'Semantic support: deterministic contract match',
    'Runtime correctness: not evaluated',
  ]) {
    assert.match(explained, new RegExp(axis));
  }

  await writeFile(path.join(fixture.dependency, 'index.d.ts'), DRIFTED_DECLARATION);
  const drift = runCli(['check', '--root', fixture.root], 1).stdout;
  for (const field of [
    'FAIL contract_mismatch',
    'Claim:',
    'Expected signature:',
    'Current signature:',
    'Affected code location: app/src/index.ts:2',
    `Receipt ID: ${id}`,
    'Action: Review the dependency change',
    'Summary: 0 pass, 0 warning, 1 fail',
  ]) {
    assert.ok(drift.includes(field), `Missing ${field} in:\n${drift}`);
  }
  assert.match(runCli(['diff', '--root', fixture.root], 0).stdout, /FAIL contract_mismatch/);
});

test('UAT: editing one line of a Receipt is blocked with a readable recovery action', async (t) => {
  const { fixture, file } = await initializeAndRecord(t);
  const receipt = JSON.parse(await readFile(file, 'utf8')) as Receipt;
  receipt.claim = 'Forged claim edited by hand.';
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`);

  const result = runCli(['check', '--root', fixture.root], 2);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /FAIL evidence_integrity/);
  assert.match(result.stdout, /Message: Receipt content hash mismatch/);
  assert.match(result.stdout, /Action: Do not trust or hand-edit this Receipt/);
  assert.match(result.stdout, /Summary: 0 pass, 0 warning, 1 fail/);
  assert.doesNotMatch(result.stdout, /\u001B\[/, 'Output must not contain ANSI control codes.');
});

test('UAT: control characters are rejected on record and in a rehashed Receipt', async (t) => {
  const fixture = await fixtureFor(t);
  runCli(['init', '--root', fixture.root], 0);

  const recordResult = runCli(recordArguments(fixture, { claim: 'forged\u001b[2Jclaim' }), 2);
  assert.equal(recordResult.stdout, '');
  assert.match(recordResult.stderr, /^ERROR: Claim must contain 1-500 safe text characters\./);
  assert.doesNotMatch(recordResult.stderr, /\u001b/u);

  const recorded = runCli(recordArguments(fixture), 0);
  const originalId = receiptIdFrom(recorded.stdout);
  const original = JSON.parse(
    await readFile(receiptPath(fixture.root, originalId), 'utf8'),
  ) as Receipt;
  const payload: ReceiptPayload = {
    schemaVersion: original.schemaVersion,
    claim: 'rehashed\u001b[2Jclaim',
    affectedCode: original.affectedCode,
    evidence: original.evidence,
  };
  const forgedId = contentHash(payload);
  await writeFile(
    receiptPath(fixture.root, forgedId),
    `${canonicalStringify({ id: forgedId, ...payload })}\n`,
  );
  await writeFile(
    path.join(fixture.root, '.litmo', 'evidence.lock'),
    `${canonicalStringify({ schemaVersion: 1, receipts: [forgedId] })}\n`,
  );

  const checkResult = runCli(['check', '--root', fixture.root], 2);
  assert.equal(checkResult.stderr, '');
  assert.match(checkResult.stdout, /FAIL evidence_integrity/);
  assert.match(checkResult.stdout, /Receipt claim must contain 1-500 safe text characters/);
  assert.doesNotMatch(checkResult.stdout, /\u001b|[\u007f-\u009f]/u);
});

test('UAT: forged matched or verified fields are rejected as untrusted input', async (t) => {
  const { fixture, file } = await initializeAndRecord(t);
  const receipt = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  receipt.matched = true;
  receipt.verified = true;
  await writeFile(file, `${JSON.stringify(receipt)}\n`);

  const result = runCli(['check', '--root', fixture.root], 2).stdout;
  assert.match(result, /FAIL evidence_integrity/);
  assert.match(result, /receipt has unknown or missing fields/);
});

test('UAT: malformed, missing, and inconsistent evidence produce classified reports', async (t) => {
  const { fixture, id, file } = await initializeAndRecord(t);
  const originalReceipt = await readFile(file, 'utf8');
  const lockPath = path.join(fixture.root, '.litmo', 'evidence.lock');
  const originalLock = await readFile(lockPath, 'utf8');

  await writeFile(file, '{broken json\n');
  assert.match(
    runCli(['check', '--root', fixture.root], 2).stdout,
    /is not valid JSON[\s\S]*Action: Do not trust/,
  );
  await writeFile(file, originalReceipt);

  const parked = `${file}.parked`;
  await rename(file, parked);
  assert.match(
    runCli(['check', '--root', fixture.root], 2).stdout,
    new RegExp(`Receipt file is missing or unreadable for ${id}`),
  );
  await rename(parked, file);

  const duplicateLock: EvidenceLock = { schemaVersion: 1, receipts: [id, id] };
  await writeFile(lockPath, `${JSON.stringify(duplicateLock)}\n`);
  assert.match(
    runCli(['check', '--root', fixture.root], 2).stdout,
    /evidence\.lock contains duplicate receipt IDs/,
  );
  await writeFile(lockPath, originalLock);
  assert.match(runCli(['check', '--root', fixture.root], 0).stdout, /PASS sha256:/);
});

test('UAT: Receipt-count limits fail before reads and prevent orphan files', async (t) => {
  const fixture = await fixtureFor(t);
  runCli(['init', '--root', fixture.root], 0);
  const lockPath = path.join(fixture.root, '.litmo', 'evidence.lock');
  const receiptsPath = path.join(fixture.root, '.litmo', 'receipts');

  await writeFile(
    lockPath,
    `${canonicalStringify({ schemaVersion: 1, receipts: fakeReceiptIds(1024) })}\n`,
  );
  const recordResult = runCli(recordArguments(fixture), 2);
  assert.match(recordResult.stderr, /maximum of 1024 Receipt IDs/);
  assert.deepEqual(await readdir(receiptsPath), []);

  await writeFile(
    lockPath,
    `${canonicalStringify({ schemaVersion: 1, receipts: fakeReceiptIds(1025) })}\n`,
  );
  const checkResult = runCli(['check', '--root', fixture.root], 2);
  assert.match(checkResult.stdout, /FAIL evidence_integrity/);
  assert.match(checkResult.stdout, /more than 1024 Receipt IDs/);
  assert.match(checkResult.stdout, /Summary: 0 pass, 0 warning, 1 fail/);
});

test('UAT: URL, missing package, missing parameter, path escape, and missing code are refused', async (t) => {
  const fixture = await fixtureFor(t);
  runCli(['init', '--root', fixture.root], 0);

  const url = runCli(
    recordArguments(fixture, { package: 'https://does-not-exist.invalid/package' }),
    2,
  );
  assert.equal(url.stdout, '');
  assert.match(
    url.stderr,
    /^ERROR: Package must be a registry-style npm package name, not a path or URL\./,
  );
  assert.doesNotMatch(url.stderr, /\u001B\[/);

  assert.match(
    runCli(recordArguments(fixture, { package: 'package-that-is-not-installed' }), 2).stderr,
    /Installed dependency package-that-is-not-installed could not be resolved/,
  );
  assert.match(
    runCli(recordArguments(fixture, { parameter: 'missingParameter' }), 2).stderr,
    /Parameter missingParameter was not found on parseConfig/,
  );
  assert.match(
    runCli(recordArguments(fixture, { code: '../outside.ts' }), 2).stderr,
    /Affected code must stay inside the repository/,
  );
  assert.match(
    runCli(recordArguments(fixture, { code: 'app/src/missing.ts' }), 2).stderr,
    /Affected code file was not found: app\/src\/missing\.ts/,
  );
});

test('UAT: an unavailable or malformed source is a clear non-blocking warning', async (t) => {
  const unavailable = await initializeAndRecord(t);
  await rm(unavailable.fixture.dependency, { recursive: true, force: true });
  const missingResult = runCli(['check', '--root', unavailable.fixture.root], 0).stdout;
  assert.match(missingResult, /WARNING unverifiable/);
  assert.match(missingResult, /Installed dependency @litmo\/demo-contract could not be resolved/);
  assert.match(missingResult, /Action: Restore the dependency source and rerun check/);
  assert.match(missingResult, /Summary: 0 pass, 1 warning, 0 fail/);

  const malformed = await initializeAndRecord(t);
  await writeFile(
    path.join(malformed.fixture.dependency, 'index.d.ts'),
    'export declare function parseConfig(: broken;\n',
  );
  const malformedResult = runCli(['check', '--root', malformed.fixture.root], 0).stdout;
  assert.match(malformedResult, /WARNING unverifiable/);
  assert.match(malformedResult, /Invalid TypeScript declaration:/);
});

test('UAT: transitive declarations cannot escape the repository', async (t) => {
  const { fixture } = await initializeAndRecord(t);
  const outside = await mkdtemp(path.join(tmpdir(), 'litmo-outside-declaration-'));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  const outsideDeclaration = path.join(outside, 'external.d.ts');
  await writeFile(outsideDeclaration, 'export interface ExternalOptions { unsafe: true; }\n');
  const specifier = path
    .relative(fixture.dependency, outsideDeclaration)
    .replaceAll('\\', '/')
    .replace(/\.d\.ts$/u, '.js');
  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    [
      `import type { ExternalOptions } from '${specifier}';`,
      'export declare function parseConfig(input: string, options?: ExternalOptions): string;',
      '',
    ].join('\n'),
  );

  const result = runCli(['check', '--root', fixture.root], 0).stdout;
  assert.match(result, /WARNING unverifiable/);
  assert.match(result, /transitive TypeScript source resolves outside the repository/);
  assert.match(result, /Action: Restore the dependency source and rerun check/);
});

test('UAT: TypeScript source count and byte budgets fail with readable errors', async (t) => {
  const tooMany = await fixtureFor(t);
  runCli(['init', '--root', tooMany.root], 0);
  const parts = path.join(tooMany.dependency, 'parts');
  await mkdir(parts);
  await Promise.all(
    Array.from({ length: 256 }, (_, index) =>
      writeFile(path.join(parts, `part-${index}.d.ts`), 'export {};\n'),
    ),
  );
  await writeFile(
    path.join(tooMany.dependency, 'index.d.ts'),
    [
      ...Array.from({ length: 256 }, (_, index) => `import './parts/part-${index}.js';`),
      'export declare function parseConfig(input: string, options?: object): string;',
      '',
    ].join('\n'),
  );
  assert.match(
    runCli(recordArguments(tooMany), 2).stderr,
    /TypeScript evidence loads more than 256 repository source files/,
  );

  const tooLarge = await fixtureFor(t);
  runCli(['init', '--root', tooLarge.root], 0);
  await writeFile(
    path.join(tooLarge.dependency, 'index.d.ts'),
    Buffer.alloc(2 * 1024 * 1024 + 1, 0x20),
  );
  assert.match(
    runCli(recordArguments(tooLarge), 2).stderr,
    /Evidence source is not a regular file under 2097152 bytes/,
  );

  const aggregate = await fixtureFor(t);
  runCli(['init', '--root', aggregate.root], 0);
  const aggregateParts = path.join(aggregate.dependency, 'parts');
  await mkdir(aggregateParts);
  const twoMiBComment = `//${'x'.repeat(2 * 1024 * 1024 - 2)}`;
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      writeFile(path.join(aggregateParts, `part-${index}.d.ts`), twoMiBComment),
    ),
  );
  await writeFile(
    path.join(aggregate.dependency, 'index.d.ts'),
    [
      ...Array.from({ length: 8 }, (_, index) => `import './parts/part-${index}.js';`),
      'export declare function parseConfig(input: string, options?: object): string;',
      '',
    ].join('\n'),
  );
  assert.match(
    runCli(recordArguments(aggregate), 2).stderr,
    /TypeScript evidence exceeds the 16777216-byte aggregate source limit/,
  );
});

test('UAT: a removed symbol or overload set is a deterministic blocking mismatch', async (t) => {
  const removed = await initializeAndRecord(t);
  await writeFile(
    path.join(removed.fixture.dependency, 'index.d.ts'),
    'export declare function replacement(input: string): string;\n',
  );
  assert.match(
    runCli(['check', '--root', removed.fixture.root], 1).stdout,
    /missing exported symbol parseConfig/,
  );

  const overloaded = await initializeAndRecord(t);
  await writeFile(
    path.join(overloaded.fixture.dependency, 'index.d.ts'),
    [
      'export declare function parseConfig(input: string): string;',
      'export declare function parseConfig(input: string, strict: boolean): string;',
      '',
    ].join('\n'),
  );
  const overloadResult = runCli(['check', '--root', overloaded.fixture.root], 1).stdout;
  assert.match(overloadResult, /v0\.1 supports symbols with exactly one call signature/);
  assert.match(overloadResult, /<2 call signatures for parseConfig>/);
});

test('UAT: boss-fight overloads with a cross-file type alias fail clearly without a Receipt', async (t) => {
  const fixture = await fixtureFor(t);
  runCli(['init', '--root', fixture.root], 0);
  await writeFile(
    path.join(fixture.dependency, 'index.d.ts'),
    await readFile(path.join(bossFightExample, 'index.d.ts'), 'utf8'),
  );
  await writeFile(
    path.join(fixture.dependency, 'interfaces.ts'),
    await readFile(path.join(bossFightExample, 'interfaces.ts'), 'utf8'),
  );

  const result = runCli(
    recordArguments(fixture, {
      symbol: 'bossFight',
      parameter: 'options',
      claim: 'bossFight accepts the complex options used by this caller.',
    }),
    2,
  );
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /^ERROR: v0\.1 supports symbols with exactly one call signature\.\r?\n$/u,
  );

  const lock = JSON.parse(
    await readFile(path.join(fixture.root, '.litmo', 'evidence.lock'), 'utf8'),
  ) as EvidenceLock;
  assert.deepEqual(lock.receipts, []);
  assert.deepEqual(await readdir(path.join(fixture.root, '.litmo', 'receipts')), []);
});

test('UAT: coordinated rehashing is internally valid and remains a documented Git-review boundary', async (t) => {
  const { fixture, file } = await initializeAndRecord(t);
  const original = JSON.parse(await readFile(file, 'utf8')) as Receipt;
  const payload: ReceiptPayload = {
    schemaVersion: original.schemaVersion,
    claim: 'A replacement claim with a newly calculated content address.',
    affectedCode: original.affectedCode,
    evidence: original.evidence,
  };
  const replacementId = contentHash(payload);
  const replacement: Receipt = { id: replacementId, ...payload };
  await writeFile(receiptPath(fixture.root, replacementId), `${canonicalStringify(replacement)}\n`);
  await writeFile(
    path.join(fixture.root, '.litmo', 'evidence.lock'),
    `${canonicalStringify({ schemaVersion: 1, receipts: [replacementId] })}\n`,
  );

  const result = runCli(['check', '--root', fixture.root], 0).stdout;
  assert.match(result, new RegExp(`PASS ${replacementId}`));
  assert.match(result, /Claim: A replacement claim with a newly calculated content address/);
});

test('UAT: demo cleanup refuses a symlink or junction without deleting outside data', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'litmo-demo-root-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'litmo-demo-outside-'));
  const demoParent = path.join(root, '.litmo-demo');
  const outsideDemo = path.join(outside, 'signature-drift');
  const sentinel = path.join(outsideDemo, 'sentinel.txt');
  await mkdir(outsideDemo);
  await writeFile(sentinel, 'must survive\n');
  try {
    await symlink(outside, demoParent, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'EPERM'
    ) {
      t.skip('The current Windows account cannot create a junction.');
      return;
    }
    throw error;
  }
  t.after(async () => {
    try {
      await unlink(demoParent);
    } catch {
      // The link may already be absent after a failed setup.
    }
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  const result = spawnSync(process.execPath, [demoScript, 'setup'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Demo refused: \.litmo-demo must be a real directory/);
  assert.doesNotMatch(result.stderr, /\n\s+at /u);
  await access(sentinel);
});
