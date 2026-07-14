import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

test('npm tarball contains the executable surface and excludes source, tests, and examples', async (t) => {
  const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    private?: boolean;
    bin?: Record<string, string>;
  };
  assert.notEqual(manifest.private, true, 'A private package cannot back `npx litmo`.');
  assert.equal(manifest.bin?.litmo, 'dist/src/cli.js');
  assert.equal(manifest.bin?.['litmo-mcp'], 'dist/src/mcp.js');

  const cache = await mkdtemp(path.join(tmpdir(), 'litmo-pack-cache-'));
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
    '.litmo/',
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
