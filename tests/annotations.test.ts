import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { renderGitHubAnnotation, renderGitHubAnnotations } from '../src/annotations.js';
import { initEvidrift, recordEvidence } from '../src/core.js';
import type { CheckResult } from '../src/types.js';
import { createFixtureRepository, DRIFTED_DECLARATION } from './helpers.js';

test('GitHub annotations point contract failures at affected code and escape commands', () => {
  const result: CheckResult = {
    receiptId: 'sha256:mismatch',
    status: 'contract_mismatch',
    blocking: true,
    claim: 'The parser accepts 100%, even here.\nReview it.',
    affectedCode: { path: 'src/parser,legacy.ts', line: 17 },
    message: 'Signature changed.',
  };

  assert.equal(
    renderGitHubAnnotation(result),
    '::error title=Evidrift contract mismatch,file=src/parser%2Clegacy.ts,line=17::Signature changed. Claim: The parser accepts 100%25, even here.%0AReview it. Receipt: sha256:mismatch',
  );
});

test('GitHub annotations keep repository-level integrity errors and omit passes', () => {
  const results: CheckResult[] = [
    {
      receiptId: '(evidence.lock)',
      status: 'integrity_error',
      blocking: true,
      message: 'Missing evidence lock.',
    },
    {
      receiptId: 'sha256:pass',
      status: 'pass',
      blocking: false,
      message: 'Contract matches.',
    },
  ];

  assert.equal(
    renderGitHubAnnotations(results),
    '::error title=Evidrift evidence integrity failure::Missing evidence lock. Receipt: (evidence.lock)',
  );
});

test('GitHub annotations render non-blocking evidence states as warnings', () => {
  const results: CheckResult[] = [
    {
      receiptId: 'sha256:source',
      status: 'source_changed',
      blocking: false,
      affectedCode: { path: 'src/client.ts' },
      message: 'Source changed.',
    },
    {
      receiptId: 'sha256:missing',
      status: 'unverifiable',
      blocking: false,
      message: 'Source unavailable.',
    },
  ];

  const rendered = renderGitHubAnnotations(results);
  assert.match(rendered, /^::warning .*file=src\/client\.ts/u);
  assert.match(rendered, /\n::warning title=Evidrift evidence unavailable::/u);
});

test('CLI emits text annotations to stdout and keeps JSON stdout machine-readable', async (t) => {
  const fixture = await createFixtureRepository();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  await initEvidrift(fixture.root);
  await recordEvidence({
    repoRoot: fixture.root,
    projectRoot: fixture.app,
    packageName: '@evidrift/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    claim: 'parseConfig keeps options optional.',
    affectedCode: { path: 'app/src/index.ts', line: 2 },
  });
  await writeFile(path.join(fixture.dependency, 'index.d.ts'), DRIFTED_DECLARATION);

  const cli = path.resolve(process.cwd(), 'dist', 'src', 'cli.js');
  const text = spawnSync(
    process.execPath,
    [cli, 'check', '--annotations', 'github', '--root', fixture.root],
    { encoding: 'utf8' },
  );
  assert.equal(text.status, 1, text.stderr);
  assert.match(
    text.stdout,
    /^::error title=Evidrift contract mismatch,file=app\/src\/index\.ts,line=2::/u,
  );
  assert.match(text.stdout, /FAIL contract_mismatch/u);
  assert.equal(text.stderr, '');

  const json = spawnSync(
    process.execPath,
    [cli, 'check', '--format', 'json', '--annotations', 'github', '--root', fixture.root],
    { encoding: 'utf8' },
  );
  assert.equal(json.status, 1);
  assert.equal((JSON.parse(json.stdout) as { exitCode?: number }).exitCode, 1);
  assert.match(json.stderr, /^::error title=Evidrift contract mismatch/u);
});
