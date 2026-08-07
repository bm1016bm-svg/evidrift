import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

test('React 19 lab stays pinned, non-executing, and publicly discoverable', async () => {
  const root = process.cwd();
  const [readme, labReadme, script, source, manifest, llms] = await Promise.all([
    readFile(path.join(root, 'README.md'), 'utf8'),
    readFile(path.join(root, 'examples', 'react-19-useref', 'README.md'), 'utf8'),
    readFile(path.join(root, 'examples', 'react-19-useref', 'run-demo.mjs'), 'utf8'),
    readFile(path.join(root, 'examples', 'react-19-useref', 'src', 'ref.ts'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'docs', 'llms.txt'), 'utf8'),
  ]);

  assert.match(readme, /## Real-world Lab — React 19 `useRef`/u);
  assert.match(readme, /react-19-upgrade-guide#useref-requires-an-argument/u);
  assert.match(labReadme, /real dependency upgrade, not a synthetic declaration/u);
  assert.match(script, /installReactTypes\('18\.3\.12'\)/u);
  assert.match(script, /installReactTypes\('19\.0\.1'\)/u);
  assert.match(script, /'--ignore-scripts'/u);
  assert.match(script, /installedReactTypesVersion/u);
  assert.match(script, /'check', '--root', demoRoot\], 1/u);
  assert.match(source, /useRef<AbortController>\(\)/u);
  assert.match(manifest, /"demo:react-19"/u);
  assert.match(llms, /Real React 19 `useRef` drift lab/u);
});
