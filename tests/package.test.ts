import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { EVIDRIFT_VERSION } from '../src/types.js';

test('npm tarball contains the executable surface and excludes source, tests, and examples', async (t) => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    private?: boolean;
    version?: string;
    mcpName?: string;
    bin?: Record<string, string>;
  };
  assert.notEqual(manifest.private, true, 'A private package cannot back `npx evidrift`.');
  assert.equal(manifest.version, EVIDRIFT_VERSION);
  assert.equal(manifest.mcpName, 'io.github.bm1016bm-svg/evidrift');
  assert.equal(manifest.bin?.evidrift, 'dist/src/cli.js');
  assert.equal(manifest.bin?.['evidrift-mcp'], 'dist/src/mcp.js');

  const cache = await mkdtemp(path.join(tmpdir(), 'evidrift-pack-cache-'));
  t.after(async () => rm(cache, { recursive: true, force: true }));

  const npmArguments = ['pack', '--json', '--dry-run', '--ignore-scripts', '--cache', cache];
  const npmExecPath = process.env.npm_execpath;
  const command =
    npmExecPath !== undefined
      ? process.execPath
      : process.platform === 'win32'
        ? (process.env.ComSpec ?? 'cmd.exe')
        : 'npm';
  const arguments_ =
    npmExecPath !== undefined
      ? [npmExecPath, ...npmArguments]
      : process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm.cmd', ...npmArguments]
        : npmArguments;
  const result = spawnSync(command, arguments_, { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const output = JSON.parse(result.stdout) as Array<{ files?: Array<{ path?: string }> }>;
  const files = output[0]?.files?.map((entry) => entry.path).filter((value) => value !== undefined);
  assert.ok(files);

  for (const required of [
    'LICENSE',
    'README.md',
    'README.zh-TW.md',
    'dist/src/annotations.js',
    'dist/src/cli.js',
    'dist/src/demo.js',
    'dist/src/github-actions.js',
    'dist/src/index.js',
    'dist/src/mcp.js',
    'dist/src/repro-demo.js',
    'dist/src/repro-http.js',
    'dist/src/repro.js',
    'package.json',
  ]) {
    assert.ok(files.includes(required), `npm tarball is missing ${required}`);
  }

  for (const forbidden of [
    '.github/',
    '.evidrift/',
    'examples/',
    'src/',
    'tests/',
    'eslint.config.js',
  ]) {
    assert.equal(
      files.some((file) => file.startsWith(forbidden)),
      false,
      `npm tarball unexpectedly contains ${forbidden}`,
    );
  }
});

test('release, npm, and official MCP Registry metadata stay version-aligned', async () => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    name?: string;
    version?: string;
    mcpName?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const lock = JSON.parse(
    await readFile(path.join(process.cwd(), 'package-lock.json'), 'utf8'),
  ) as {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
  const server = JSON.parse(await readFile(path.join(process.cwd(), 'server.json'), 'utf8')) as {
    name?: string;
    version?: string;
    packages?: Array<{
      identifier?: string;
      version?: string;
      transport?: { type?: string };
      packageArguments?: Array<{ type?: string; value?: string }>;
    }>;
  };
  const registryPackage = server.packages?.[0];

  assert.equal(manifest.version, EVIDRIFT_VERSION);
  assert.equal(lock.version, EVIDRIFT_VERSION);
  assert.equal(lock.packages?.['']?.version, EVIDRIFT_VERSION);
  assert.equal(server.version, EVIDRIFT_VERSION);
  assert.equal(server.name, manifest.mcpName);
  assert.equal(registryPackage?.identifier, manifest.name);
  assert.equal(registryPackage?.version, EVIDRIFT_VERSION);
  assert.equal(registryPackage?.transport?.type, 'stdio');
  assert.deepEqual(registryPackage?.packageArguments, [{ type: 'positional', value: 'mcp' }]);
  assert.equal(manifest.dependencies?.['@modelcontextprotocol/sdk'], undefined);
  assert.equal(manifest.dependencies?.zod, undefined);
  assert.equal(manifest.devDependencies?.['@modelcontextprotocol/sdk'], '1.29.0');

  const workflow = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.match(workflow, /id-token: write/u);
  assert.doesNotMatch(workflow, /NPM_TOKEN/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /RELEASE_TAG:/u);
  assert.match(workflow, /npm audit --omit=dev --audit-level=moderate/u);
  assert.match(workflow, /npm view "evidrift@\$\{VERSION\}" gitHead/u);
  assert.match(workflow, /PUBLISHED_SHA.*TAGGED_SHA/su);
  assert.match(workflow, /\$\{RUNNER_TEMP\}\/mcp-validation\.json/u);
  assert.doesNotMatch(workflow, /--output mcp-validation\.json/u);
  assert.match(workflow, /mcp-publisher_linux_amd64\.tar\.gz/u);
  for (const use of workflow.matchAll(/^\s*uses:\s*(\S+)$/gmu)) {
    assert.match(use[1] ?? '', /@[a-f0-9]{40}$/u, `Action is not pinned: ${use[1]}`);
  }
});

test('CI verifies supported Node releases on Linux and Windows', async () => {
  const workflow = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
    'utf8',
  );

  assert.match(workflow, /runs-on: \$\{\{ matrix\.os \}\}/u);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/u);
  assert.match(workflow, /node: \[22, 24\]/u);
  assert.match(workflow, /run: npm ci --ignore-scripts/u);
  assert.match(workflow, /run: npm run verify/u);
  for (const use of workflow.matchAll(/^\s*uses:\s*(\S+)$/gmu)) {
    assert.match(use[1] ?? '', /@[a-f0-9]{40}$/u, `Action is not pinned: ${use[1]}`);
  }
});

test('root Action metadata is Marketplace-ready and delegates without a shell', async () => {
  const runnerPath = path.join(process.cwd(), 'scripts', 'run-action.mjs');
  const [metadata, runner] = await Promise.all([
    readFile(path.join(process.cwd(), 'action.yml'), 'utf8'),
    readFile(runnerPath, 'utf8'),
  ]);

  assert.match(metadata, /^name: Evidrift Contract Drift Check$/mu);
  assert.match(metadata, /^description: .+$/mu);
  assert.match(metadata, /^branding:$/mu);
  assert.match(metadata, /^\s+annotations:$/mu);
  assert.match(metadata, /^\s+default: github$/mu);
  assert.match(metadata, /^\s+using: composite$/mu);
  assert.match(metadata, /node "\$GITHUB_ACTION_PATH\/scripts\/run-action\.mjs"/u);
  assert.match(runner, /`evidrift@\$\{version\}`/u);
  assert.match(runner, /'--ignore-scripts'/u);
  assert.match(runner, /--registry=https:\/\/registry\.npmjs\.org\//u);
  assert.match(runner, /cwd: actionRoot/u);
  assert.match(runner, /process\.execPath/u);
  assert.match(runner, /npm-cli\.js/u);
  assert.doesNotMatch(runner, /npx\.cmd/u);
  assert.match(runner, /GITHUB_WORKSPACE/u);
  assert.match(runner, /path\.relative\(workspaceRoot, targetRoot\)/u);
  assert.match(runner, /'--root',\s+targetRoot/su);
  assert.match(runner, /npm_config_registry: 'https:\/\/registry\.npmjs\.org\/'/u);
  assert.match(runner, /'--format',\s+format/su);
  assert.match(runner, /'--annotations',\s+annotations/su);
  assert.match(runner, /shell: false/u);
  assert.doesNotMatch(runner, /shell:\s*true/u);
  assert.doesNotMatch(runner, /exec(?:File|Sync)?\(/u);

  const escapedRoot = spawnSync(process.execPath, [runnerPath], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EVIDRIFT_ACTION_ROOT: '../outside',
      GITHUB_WORKSPACE: process.cwd(),
    },
  });
  assert.notEqual(escapedRoot.status, 0);
  assert.match(escapedRoot.stderr, /must stay inside GITHUB_WORKSPACE/u);
});
