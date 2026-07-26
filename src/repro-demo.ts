import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { minimizeHttpReproduction, type ReproductionArtifact } from './repro-http.js';

const DEMO_RESPONSE_LIMIT = 64 * 1024;

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

export async function runReproMinDemo(): Promise<ReproductionArtifact> {
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > DEMO_RESPONSE_LIMIT) {
          response.writeHead(413, { 'content-type': 'application/json' });
          response.end('{"error":{"code":"PAYLOAD_TOO_LARGE"}}');
          return;
        }
        chunks.push(buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        filters?: { unsupported?: { mode?: string } };
      };
      if (body.filters?.unsupported?.mode === 'explode') {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end('{"error":{"code":"INVALID_FILTER","type":"ValidationError"}}');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end('{"error":{"code":"INVALID_JSON"}}');
    }
  });
  const port = await listen(server);
  try {
    return await minimizeHttpReproduction(
      {
        schemaVersion: 1,
        url: `http://127.0.0.1:${port}/search`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          traceId: 'demo-123',
          query: 'quarterly report',
          filters: {
            region: ['north', 'south'],
            date: { from: '2026-01-01', to: '2026-07-26' },
            unsupported: { mode: 'explode', retries: [1, 2, 3] },
          },
          page: { number: 1, size: 100 },
        },
      },
      {
        status: 500,
        responsePointer: '/error/code',
        responseEquals: 'INVALID_FILTER',
      },
      {
        confirmReplay: true,
        maxProbes: 100,
        timeoutMs: 2_000,
      },
    );
  } finally {
    await close(server);
  }
}
