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
  assert.match(llms, /npx --yes evidrift demo/u);
  assert.match(llms, /Evidrift does not prove runtime correctness/u);
});
