import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

import { EVIDRIFT_VERSION } from '../src/types.js';

const SITE_URL = 'https://bm1016bm-svg.github.io/evidrift/';

test('public metadata names the concrete API-drift use case consistently', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    description?: string;
    homepage?: string;
    keywords?: string[];
  };
  const serverJson = JSON.parse(
    await readFile(path.join(process.cwd(), 'server.json'), 'utf8'),
  ) as { description?: string };
  const readme = await readFile(path.join(process.cwd(), 'README.md'), 'utf8');

  assert.equal(packageJson.homepage, SITE_URL);
  assert.match(packageJson.description ?? '', /TypeScript API/u);
  assert.match(packageJson.description ?? '', /OpenAPI contract drift/u);
  assert.match(serverJson.description ?? '', /TypeScript API/u);
  assert.match(serverJson.description ?? '', /OpenAPI contract drift/u);
  assert.match(
    readme,
    /^# Evidrift — API drift checks for AI-generated TypeScript and OpenAPI code$/mu,
  );

  for (const keyword of [
    'api-drift',
    'contract-testing',
    'dependency-contracts',
    'evidence-lockfile',
    'json-pointer',
    'mcp-server',
    'openapi',
    'openapi-drift',
    'typescript',
  ]) {
    assert.ok(packageJson.keywords?.includes(keyword), `npm metadata is missing ${keyword}`);
  }
});

test('GitHub Pages discovery files are internally aligned and machine readable', async () => {
  const [html, robots, sitemap, llms] = await Promise.all([
    readFile(path.join(process.cwd(), 'docs', 'index.html'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'robots.txt'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'sitemap.xml'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'llms.txt'), 'utf8'),
  ]);

  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE_URL}"`));
  assert.match(html, /name="description"/u);
  assert.match(html, /property="og:image"/u);
  assert.match(html, /type="application\/ld\+json"/u);
  assert.match(html, new RegExp(`"softwareVersion": "${EVIDRIFT_VERSION}"`));
  assert.match(robots, /Sitemap: https:\/\/bm1016bm-svg\.github\.io\/evidrift\/sitemap\.xml/u);
  assert.match(sitemap, /<loc>https:\/\/bm1016bm-svg\.github\.io\/evidrift\/<\/loc>/u);
  assert.match(llms, /npx --yes evidrift@latest demo/u);
  assert.match(llms, /Evidrift does not prove runtime correctness/u);
});

test('the first-visit path leads with a real, lightweight CLI demo', async () => {
  const [readme, html, transcript, gif] = await Promise.all([
    readFile(path.join(process.cwd(), 'README.md'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'index.html'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'assets', 'evidrift-demo-transcript.txt'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'assets', 'evidrift-demo.gif')),
  ]);

  const demoIndex = readme.indexOf('npx --yes evidrift@latest demo');
  const adoptIndex = readme.indexOf('## Installation — Add It to a Repository');
  assert.ok(demoIndex >= 0 && adoptIndex > demoIndex, 'README must let visitors try before setup');
  assert.match(readme, /docs\/assets\/evidrift-demo\.gif/u);
  assert.match(readme, /captured CLI transcript/u);
  assert.match(html, /assets\/evidrift-demo\.gif/u);
  assert.match(html, /★ Star on GitHub/u);
  assert.match(transcript, /PASS sha256:[a-f0-9]{64}/u);
  assert.match(transcript, /FAIL contract_mismatch sha256:[a-f0-9]{64}/u);
  assert.match(transcript, /options\?:ParseOptions/u);
  assert.match(transcript, /options:ParseOptions/u);
  assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.ok(gif.byteLength < 2 * 1024 * 1024, 'README demo GIF must stay under 2 MiB');
});
