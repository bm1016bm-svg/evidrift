import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { ReproductionArtifact } from '../src/repro-http.js';

const cli = path.resolve(process.cwd(), 'dist', 'src', 'cli.js');

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(arguments_: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...arguments_], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('CLI offers a zero-setup ReproMin demo', async () => {
  const result = await runCli(['repro-demo']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^Evidrift ReproMin demo/u);
  assert.ok(result.stdout.includes('Minimal JSON: {"filters":{"unsupported":{"mode":"explode"}}}'));
  assert.match(result.stdout, /No remote host, account, API key/u);
});

test('CLI minimizes and replays a loopback failure as a content-addressed artifact', async (t) => {
  const repository = await mkdtemp(path.join(tmpdir(), 'evidrift-repro-cli-'));
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      failure?: { active?: boolean };
    };
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: { code: body.failure?.active === true ? 'BROKEN' : 'OTHER' },
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    await rm(repository, { recursive: true, force: true });
  });

  const address = server.address() as AddressInfo;
  await writeFile(
    path.join(repository, 'request.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        url: `http://127.0.0.1:${address.port}/failure`,
        method: 'POST',
        body: {
          noise: [1, 2, 3],
          failure: { active: true, detail: 'remove' },
        },
      },
      null,
      2,
    )}\n`,
  );

  const mismatch = await runCli([
    'minimize',
    '--root',
    repository,
    '--request',
    'request.json',
    '--status',
    '500',
    '--response-pointer',
    '/error/code',
    '--response-equals',
    '"DIFFERENT"',
    '--output',
    'mismatch.json',
    '--confirm-replay',
    'yes',
  ]);
  assert.equal(mismatch.status, 1, mismatch.stderr);
  assert.match(mismatch.stdout, /^MISMATCH /u);
  await assert.rejects(access(path.join(repository, 'mismatch.json')));

  const minimized = await runCli([
    'minimize',
    '--root',
    repository,
    '--request',
    'request.json',
    '--status',
    '500',
    '--response-pointer',
    '/error/code',
    '--response-equals',
    '"BROKEN"',
    '--output',
    'minimal-repro.json',
    '--confirm-replay',
    'yes',
  ]);
  assert.equal(minimized.status, 0, minimized.stderr);
  assert.equal(minimized.stderr, '');
  assert.match(minimized.stdout, /^MINIMIZED sha256:/u);
  assert.match(minimized.stdout, /Next: run `evidrift reproduce`/u);
  assert.doesNotMatch(minimized.stdout, /Replay: /u);

  const artifact = JSON.parse(
    await readFile(path.join(repository, 'minimal-repro.json'), 'utf8'),
  ) as ReproductionArtifact;
  assert.deepEqual(artifact.request.body, { failure: { active: true } });

  const replayed = await runCli([
    'reproduce',
    '--root',
    repository,
    '--artifact',
    'minimal-repro.json',
    '--confirm-replay',
    'yes',
  ]);
  assert.equal(replayed.status, 0, replayed.stderr);
  assert.match(replayed.stdout, /^MATCH sha256:/u);
  assert.match(replayed.stdout, /Failure predicate: matched/u);
});

test('CLI reports an unavailable target as an error without writing an artifact', async (t) => {
  const repository = await mkdtemp(path.join(tmpdir(), 'evidrift-repro-mismatch-'));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  await writeFile(
    path.join(repository, 'request.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      url: 'http://127.0.0.1:9/failure',
      method: 'POST',
      body: { value: true },
    })}\n`,
  );

  const result = await runCli([
    'minimize',
    '--root',
    repository,
    '--request',
    'request.json',
    '--status',
    '500',
    '--response-contains',
    'expected',
    '--output',
    'must-not-exist.json',
    '--confirm-replay',
    'yes',
    '--timeout-ms',
    '100',
  ]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^ERROR: HTTP probe failed:/u);
  await assert.rejects(access(path.join(repository, 'must-not-exist.json')));
});
