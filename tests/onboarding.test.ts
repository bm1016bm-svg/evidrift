import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const cli = path.resolve(process.cwd(), 'dist', 'src', 'cli.js');

test('running Evidrift without arguments is a successful, copy-pasteable onboarding path', () => {
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /See deterministic drift in one command/u);
  assert.match(result.stdout, /npx --yes evidrift@latest demo/u);
  assert.match(result.stdout, /evidrift repro-demo/u);
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

test('init --github-actions adds an idempotent package script and annotated PR workflow', async (t) => {
  const repository = await mkdtemp(path.join(tmpdir(), 'evidrift-actions-'));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await writeFile(
    path.join(repository, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        packageManager: 'npm@11.6.2',
        scripts: { test: 'node --test' },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(repository, 'package-lock.json'), '{}\n');

  const first = spawnSync(
    process.execPath,
    [cli, 'init', '--github-actions', '--root', repository],
    { encoding: 'utf8' },
  );
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /GitHub Actions: created \.github\/workflows\/evidrift\.yml/u);
  assert.match(first.stdout, /Package script: created scripts\.evidrift:check \(npm\)/u);

  const packageJson = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.scripts?.test, 'node --test');
  assert.equal(packageJson.scripts?.['evidrift:check'], 'npx --yes evidrift@0.4.1 check');

  const workflowPath = path.join(repository, '.github', 'workflows', 'evidrift.yml');
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /^on:\n  pull_request:$/mu);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /run: npm ci --ignore-scripts/u);
  assert.match(workflow, /uses: bm1016bm-svg\/evidrift@v0\.4\.1/u);
  assert.match(workflow, /annotations: github/u);

  const second = spawnSync(
    process.execPath,
    [cli, 'init', '--github-actions', '--root', repository],
    { encoding: 'utf8' },
  );
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /GitHub Actions: unchanged/u);
  assert.match(second.stdout, /Package script: unchanged/u);
  assert.equal(await readFile(workflowPath, 'utf8'), workflow);
});

test('init --github-actions preserves conflicting user-owned workflow and package script', async (t) => {
  const repository = await mkdtemp(path.join(tmpdir(), 'evidrift-actions-existing-'));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await mkdir(path.join(repository, '.github', 'workflows'), { recursive: true });
  await writeFile(
    path.join(repository, 'package.json'),
    `${JSON.stringify(
      {
        name: 'fixture-app',
        private: true,
        scripts: { 'evidrift:check': 'custom-check' },
      },
      null,
      2,
    )}\n`,
  );
  const existingWorkflow = 'name: Existing\n';
  await writeFile(path.join(repository, '.github', 'workflows', 'evidrift.yml'), existingWorkflow);

  const result = spawnSync(
    process.execPath,
    [cli, 'init', '--github-actions', '--root', repository],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GitHub Actions: preserved/u);
  assert.match(result.stdout, /Package script: preserved/u);
  assert.equal(
    await readFile(path.join(repository, '.github', 'workflows', 'evidrift.yml'), 'utf8'),
    existingWorkflow,
  );
  const packageJson = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.scripts?.['evidrift:check'], 'custom-check');
});

test('init --github-actions generates locked pnpm and modern Yarn install steps', async (t) => {
  const cases = [
    {
      packageManager: 'pnpm@10.0.0',
      lockfile: 'pnpm-lock.yaml',
      install: 'pnpm install --frozen-lockfile --ignore-scripts',
    },
    {
      packageManager: 'yarn@4.9.1',
      lockfile: 'yarn.lock',
      install: 'yarn install --immutable --mode=skip-builds',
    },
  ];

  for (const fixture of cases) {
    const repository = await mkdtemp(path.join(tmpdir(), 'evidrift-actions-manager-'));
    t.after(async () => rm(repository, { recursive: true, force: true }));
    await writeFile(
      path.join(repository, 'package.json'),
      `${JSON.stringify(
        { name: 'fixture-app', private: true, packageManager: fixture.packageManager },
        null,
        2,
      )}\n`,
    );
    await writeFile(path.join(repository, fixture.lockfile), '\n');

    const result = spawnSync(
      process.execPath,
      [cli, 'init', '--github-actions', '--root', repository],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const workflow = await readFile(
      path.join(repository, '.github', 'workflows', 'evidrift.yml'),
      'utf8',
    );
    assert.match(workflow, /run: corepack enable/u);
    assert.ok(workflow.includes(`run: ${fixture.install}`));
  }
});
