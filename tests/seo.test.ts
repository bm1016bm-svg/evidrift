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
  const [readme, readmeZhTw] = await Promise.all([
    readFile(path.join(process.cwd(), 'README.md'), 'utf8'),
    readFile(path.join(process.cwd(), 'README.zh-TW.md'), 'utf8'),
  ]);

  assert.equal(packageJson.homepage, SITE_URL);
  assert.match(packageJson.description ?? '', /TypeScript API/u);
  assert.match(packageJson.description ?? '', /OpenAPI contract drift/u);
  assert.match(serverJson.description ?? '', /TypeScript API/u);
  assert.match(serverJson.description ?? '', /OpenAPI contract drift/u);
  assert.match(
    readme,
    /^# Evidrift — API drift checks for AI-generated TypeScript and OpenAPI code$/mu,
  );
  assert.match(readme, /\[繁體中文\]\(README\.zh-TW\.md\)/u);
  assert.match(
    readmeZhTw,
    /^# Evidrift — 檢查 AI 產生的 TypeScript 與 OpenAPI 程式碼是否發生 API drift$/mu,
  );
  assert.match(readmeZhTw, /\[English\]\(README\.md\)/u);

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

test('Traditional Chinese docs are discoverable and keep machine interfaces stable', async () => {
  const [readme, html, htmlZhTw, faqZhTw, caseZhTw, sitemap, llms] = await Promise.all([
    readFile(path.join(process.cwd(), 'README.md'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'index.html'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'zh-TW', 'index.html'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'zh-TW', 'faq.html'), 'utf8'),
    readFile(
      path.join(process.cwd(), 'docs', 'zh-TW', 'cases', 'typescript-signature-drift.html'),
      'utf8',
    ),
    readFile(path.join(process.cwd(), 'docs', 'sitemap.xml'), 'utf8'),
    readFile(path.join(process.cwd(), 'docs', 'llms.txt'), 'utf8'),
  ]);

  assert.match(readme, /README\.zh-TW\.md/u);
  assert.match(html, /href="\.\/zh-TW\/"/u);
  assert.match(html, /hreflang="zh-Hant"/u);
  assert.match(htmlZhTw, /<html lang="zh-Hant-TW">/u);
  assert.match(
    htmlZhTw,
    /<link rel="canonical" href="https:\/\/bm1016bm-svg\.github\.io\/evidrift\/zh-TW\/"/u,
  );
  assert.match(htmlZhTw, new RegExp(`"softwareVersion": "${EVIDRIFT_VERSION}"`));
  assert.match(htmlZhTw, /npx --yes evidrift@latest demo/u);
  assert.match(htmlZhTw, /Receipt/u);
  assert.match(htmlZhTw, /typescript\.symbol/u);
  assert.match(htmlZhTw, /json\.pointer/u);
  assert.match(faqZhTw, /FAIL contract_mismatch/u);
  assert.match(faqZhTw, /WARNING source_changed/u);
  assert.match(faqZhTw, /evidrift check/u);
  assert.match(caseZhTw, /TypeScript 編譯通過，但 dependency signature 已漂移/u);
  assert.match(caseZhTw, /Expected signature:/u);
  assert.match(caseZhTw, /Current signature:/u);
  assert.match(caseZhTw, /Affected code location:/u);
  assert.match(caseZhTw, /Receipt ID:/u);
  assert.match(caseZhTw, /FAIL contract_mismatch/u);
  assert.match(
    sitemap,
    /<loc>https:\/\/bm1016bm-svg\.github\.io\/evidrift\/zh-TW\/cases\/typescript-signature-drift\.html<\/loc>/u,
  );
  assert.match(llms, /Traditional Chinese README/u);
  assert.match(llms, /zh-TW\/faq\.html/u);
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
