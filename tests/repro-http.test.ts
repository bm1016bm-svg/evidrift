import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';

import {
  minimizeHttpReproduction,
  parseReproductionArtifact,
  readRequestFixture,
  ReproSafetyError,
  verifyHttpReproduction,
  writeReproductionArtifact,
  type FailurePredicate,
  type HttpRequestFixture,
} from '../src/repro-http.js';
import { ReproductionMismatchError } from '../src/repro.js';

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function fixtureServer(t: TestContext): Promise<{
  fixture: HttpRequestFixture;
  probeHits: () => number;
  targetHits: () => number;
}> {
  let probeHitCount = 0;
  let targetHitCount = 0;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/target' });
      response.end();
      return;
    }
    if (request.url === '/target') {
      targetHitCount += 1;
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('redirect target');
      return;
    }

    probeHitCount += 1;
    const body = (await readJson(request)) as {
      other?: boolean;
      payload?: { bad?: boolean };
    };
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          code: body.payload?.bad === true ? 'INVALID_FILTER' : 'DIFFERENT_FAILURE',
        },
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  );
  const address = server.address() as AddressInfo;
  return {
    fixture: {
      schemaVersion: 1,
      url: `http://127.0.0.1:${address.port}/failure`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {
        trace: 'remove',
        payload: { bad: true, noise: ['remove', 'this'] },
        other: true,
      },
    },
    probeHits: () => probeHitCount,
    targetHits: () => targetHitCount,
  };
}

const predicate: FailurePredicate = {
  status: 500,
  responsePointer: '/error/code',
  responseEquals: 'INVALID_FILTER',
};

test('minimizes a real loopback JSON request and emits a verifiable artifact', async (t) => {
  const { fixture } = await fixtureServer(t);
  const artifact = await minimizeHttpReproduction(fixture, predicate, {
    confirmReplay: true,
  });

  assert.deepEqual(artifact.request.body, { payload: { bad: true } });
  assert.ok(artifact.evidence.minimizedBytes < artifact.evidence.originalBytes);
  assert.equal(artifact.evidence.budgetExhausted, false);
  assert.match(artifact.reproId, /^sha256:[a-f0-9]{64}$/u);

  const verification = await verifyHttpReproduction(artifact, { confirmReplay: true });
  assert.equal(verification.observation.status, 500);
  assert.equal(verification.observation.matched, true);
});

test('does not accept a different HTTP 500 as the same failure', async (t) => {
  const { fixture } = await fixtureServer(t);
  const artifact = await minimizeHttpReproduction(fixture, predicate, {
    confirmReplay: true,
  });
  assert.deepEqual(artifact.request.body, { payload: { bad: true } });
});

test('marks a result as partial when the probe budget ends before minimization', async (t) => {
  const { fixture, probeHits } = await fixtureServer(t);
  const artifact = await minimizeHttpReproduction(fixture, predicate, {
    confirmReplay: true,
    maxProbes: 2,
  });
  assert.deepEqual(artifact.request.body, fixture.body);
  assert.equal(probeHits(), 2);
  assert.equal(artifact.evidence.probes, 2);
  assert.equal(artifact.evidence.budgetExhausted, true);
  assert.equal(
    artifact.evidence.claim,
    'smallest verified candidate found before the probe budget was exhausted',
  );
});

test('refuses a baseline that does not satisfy the explicit error identity', async (t) => {
  const { fixture } = await fixtureServer(t);
  await assert.rejects(
    minimizeHttpReproduction(
      fixture,
      {
        status: 500,
        responsePointer: '/error/code',
        responseEquals: 'NOT_THE_FAILURE',
      },
      { confirmReplay: true },
    ),
    ReproductionMismatchError,
  );
});

test('rejects remote targets, secret-bearing headers, and missing replay confirmation', async () => {
  const base: HttpRequestFixture = {
    schemaVersion: 1,
    url: 'http://127.0.0.1:3000/failure',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { bad: true },
  };
  for (const unsafeUrl of [
    'http://192.168.1.2/failure',
    'http://169.254.169.254/latest/meta-data',
    'http://localhost:3000/failure',
    'http://2130706433/failure',
    'http://0x7f000001/failure',
    'http://127.0.0.1.evil/failure',
    'http://[::ffff:127.0.0.1]/failure',
    'http://127.0.0.1@evil.example/failure',
  ]) {
    await assert.rejects(
      minimizeHttpReproduction({ ...base, url: unsafeUrl }, predicate, {
        confirmReplay: true,
      }),
      /only permits literal dotted 127\.0\.0\.0\/8 or bracketed ::1/u,
    );
  }
  await assert.rejects(
    minimizeHttpReproduction({ ...base, headers: { authorization: 'Bearer secret' } }, predicate, {
      confirmReplay: true,
    }),
    ReproSafetyError,
  );
  await assert.rejects(
    minimizeHttpReproduction({ ...base, headers: { 'x-auth': 'synthetic' } }, predicate, {
      confirmReplay: true,
    }),
    ReproSafetyError,
  );
  await assert.rejects(
    minimizeHttpReproduction(
      {
        ...base,
        headers: {
          'Content-Type': 'application/json',
          'content-type': 'application/json',
        },
      },
      predicate,
      { confirmReplay: true },
    ),
    /duplicates another header name/u,
  );
  await assert.rejects(
    minimizeHttpReproduction(
      { ...base, url: 'http://127.0.0.1:3000/failure?token=secret' },
      predicate,
      { confirmReplay: true },
    ),
    /looks secret-bearing/u,
  );
  await assert.rejects(
    minimizeHttpReproduction(
      { ...base, url: 'http://127.0.0.1:3000/failure?key=sk-query' },
      predicate,
      { confirmReplay: true },
    ),
    /looks secret-bearing/u,
  );
  await assert.rejects(
    minimizeHttpReproduction({ ...base, body: { password: 'synthetic' } }, predicate, {
      confirmReplay: true,
    }),
    /field "password" looks secret-bearing/u,
  );
  await assert.rejects(
    minimizeHttpReproduction({ ...base, body: { data: 'Bearer sk-header' } }, predicate, {
      confirmReplay: true,
    }),
    /looks secret-bearing/u,
  );
  await assert.rejects(
    minimizeHttpReproduction(base, predicate, { confirmReplay: false }),
    /pass --confirm-replay yes/u,
  );
  await assert.rejects(
    minimizeHttpReproduction(base, predicate, { confirmReplay: true, maxProbes: 1 }),
    /baseline and final verification/u,
  );
});

test('enforces timeout as a wall-clock limit even while a response is active', async (t) => {
  const server = createServer((request, response) => {
    request.resume();
    response.writeHead(500, { 'content-type': 'text/plain' });
    const interval = setInterval(() => response.write('.'), 40);
    response.on('close', () => clearInterval(interval));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  );
  const address = server.address() as AddressInfo;
  const fixture: HttpRequestFixture = {
    schemaVersion: 1,
    url: `http://127.0.0.1:${address.port}/slow`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { bad: true },
  };

  const started = Date.now();
  await assert.rejects(
    minimizeHttpReproduction(
      fixture,
      { status: 500, responseContains: '.' },
      { confirmReplay: true, maxProbes: 2, timeoutMs: 100 },
    ),
    /exceeded the 100 ms timeout/u,
  );
  assert.ok(Date.now() - started < 500, 'probe exceeded its bounded wall-clock allowance');
});

test('never follows redirects during a reproduction probe', async (t) => {
  const { fixture, targetHits } = await fixtureServer(t);
  await assert.rejects(
    minimizeHttpReproduction(
      { ...fixture, url: fixture.url.replace('/failure', '/redirect') },
      { status: 200, responseContains: 'redirect target' },
      { confirmReplay: true },
    ),
    ReproductionMismatchError,
  );
  assert.equal(targetHits(), 0);
});

test('detects request or predicate tampering through the reproduction ID', async (t) => {
  const { fixture } = await fixtureServer(t);
  const artifact = await minimizeHttpReproduction(fixture, predicate, {
    confirmReplay: true,
  });
  const tampered = structuredClone(artifact);
  tampered.request.url = tampered.request.url.replace('/failure', '/other');
  assert.throws(() => parseReproductionArtifact(tampered), /does not match reproId/u);

  const forgedEvidence = structuredClone(artifact);
  forgedEvidence.evidence.probes += 1;
  assert.throws(() => parseReproductionArtifact(forgedEvidence), /does not match reproId/u);
});

test('writes artifacts only to a new repository-confined file', async (t) => {
  const { fixture } = await fixtureServer(t);
  const repository = await mkdtemp(path.join(tmpdir(), 'evidrift-repro-output-'));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const artifact = await minimizeHttpReproduction(fixture, predicate, {
    confirmReplay: true,
  });

  assert.equal(
    await writeReproductionArtifact(repository, 'minimal-repro.json', artifact),
    'minimal-repro.json',
  );
  await assert.rejects(
    writeReproductionArtifact(repository, 'minimal-repro.json', artifact),
    /already exists; refusing to overwrite/u,
  );
  await assert.rejects(
    writeReproductionArtifact(repository, '../outside.json', artifact),
    /must stay inside the repository/u,
  );
});

test('rejects invalid UTF-8 fixture bytes instead of replaying replacement text', async (t) => {
  const repository = await mkdtemp(path.join(tmpdir(), 'evidrift-repro-utf8-'));
  t.after(async () => rm(repository, { recursive: true, force: true }));
  const prefix = Buffer.from(
    '{"schemaVersion":1,"url":"http://127.0.0.1:3000/failure","method":"POST","body":{"value":"',
  );
  const suffix = Buffer.from('"}}');
  await writeFile(
    path.join(repository, 'invalid.json'),
    Buffer.concat([prefix, Buffer.from([0xff]), suffix]),
  );

  await assert.rejects(readRequestFixture(repository, 'invalid.json'), /is not valid UTF-8/u);
});
