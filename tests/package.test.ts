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
    'dist/src/cli.js',
    'dist/src/demo.js',
    'dist/src/index.js',
    'dist/src/mcp.js',
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

  const workflow = await readFile(
    path.join(process.cwd(), '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.match(workflow, /id-token: write/u);
  assert.doesNotMatch(workflow, /NPM_TOKEN/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /RELEASE_TAG:/u);
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
