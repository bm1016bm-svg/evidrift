import { createServer } from 'node:http';

const host = '127.0.0.1';
const port = 4319;
const bodyLimit = 64 * 1024;

const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/search') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":{"code":"NOT_FOUND"}}');
    return;
  }

  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > bodyLimit) {
        response.writeHead(413, { 'content-type': 'application/json' });
        response.end('{"error":{"code":"PAYLOAD_TOO_LARGE"}}');
        return;
      }
      chunks.push(buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body?.filters?.unsupported?.mode === 'explode') {
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

server.listen(port, host, () => {
  console.log(`ReproMin fixture listening on http://${host}:${port}/search`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
