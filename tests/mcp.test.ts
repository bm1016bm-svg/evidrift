import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { initEvidrift } from '../src/core.js';
import { readEvidenceLock } from '../src/storage.js';
import { createFixtureRepository } from './helpers.js';

function isTextContent(value: unknown): value is { type: 'text'; text: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    value.type === 'text' &&
    'text' in value &&
    typeof value.text === 'string'
  );
}

test('STDIO MCP records through the same core and never declares verification', async () => {
  const fixture = await createFixtureRepository();
  await initEvidrift(fixture.root);
  const client = new Client({ name: 'evidrift-test-client', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(process.cwd(), 'dist', 'src', 'mcp.js')],
    cwd: fixture.root,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'evidrift_record',
      arguments: {
        projectRoot: 'app',
        packageName: '@evidrift/demo-contract',
        symbol: 'parseConfig',
        parameter: 'options',
        claim: 'parseConfig accepts an optional options parameter.',
        affectedCodePath: 'app/src/index.ts',
        affectedCodeLine: 2,
      },
    });
    assert.equal(result.isError, undefined);
    assert.ok(Array.isArray(result.content));
    const text = result.content.find(isTextContent);
    assert.ok(text);
    assert.match(text.text, /RECORDED sha256:/);
    assert.match(text.text, /no verified or runtime-correctness claim was stored/);
    assert.doesNotMatch(text.text, /verified: true/i);
    const lock = await readEvidenceLock(fixture.root);
    assert.equal(lock.receipts.length, 1);
  } finally {
    await client.close();
  }
});

test('STDIO MCP rejects URLs and raw verification fields without writing a receipt', async () => {
  const fixture = await createFixtureRepository();
  await initEvidrift(fixture.root);
  const client = new Client({ name: 'evidrift-uat-client', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(process.cwd(), 'dist', 'src', 'mcp.js')],
    cwd: fixture.root,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const urlResult = await client.callTool({
      name: 'evidrift_record',
      arguments: {
        projectRoot: 'app',
        packageName: 'https://does-not-exist.invalid/package',
        symbol: 'parseConfig',
        claim: 'A URL must not become executable evidence.',
        affectedCodePath: 'app/src/index.ts',
      },
    });
    assert.equal(urlResult.isError, true);
    assert.ok(Array.isArray(urlResult.content));
    const urlText = urlResult.content.find(isTextContent);
    assert.ok(urlText);
    assert.match(urlText.text, /registry-style npm package name, not a path or URL/);

    const rawStatusResult = await client.callTool({
      name: 'evidrift_record',
      arguments: {
        projectRoot: 'app',
        packageName: '@evidrift/demo-contract',
        symbol: 'parseConfig',
        claim: 'Raw status fields must be rejected.',
        affectedCodePath: 'app/src/index.ts',
        verified: true,
      },
    });
    assert.equal(rawStatusResult.isError, true);
    const lock = await readEvidenceLock(fixture.root);
    assert.equal(lock.receipts.length, 0);
  } finally {
    await client.close();
  }
});
