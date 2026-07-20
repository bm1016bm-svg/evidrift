import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const cli = path.resolve(process.cwd(), 'dist', 'src', 'cli.js');

test('running Evidrift without arguments is a successful, copy-pasteable onboarding path', () => {
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /See deterministic drift in one command/u);
  assert.match(result.stdout, /npx --yes evidrift@latest demo/u);
  assert.match(result.stdout, /evidrift init/u);
  assert.equal(result.stderr, '');
});

test('init creates storage and prints concrete next steps without requiring an account', async (t) => {
  const repository = await mkdtemp(path.join(tmpdir(), 'evidrift-onboarding-'));
  t.after(async () => rm(repository, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [cli, 'init', '--root', repository], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Initialized \.evidrift\/evidence\.lock/u);
  assert.match(result.stdout, /Connect your coding agent/u);
  assert.match(result.stdout, /run `npx evidrift check` in CI/u);
  assert.match(result.stdout, /npx --yes evidrift@latest demo/u);
});
