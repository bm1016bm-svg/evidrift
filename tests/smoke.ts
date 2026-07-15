import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createFixtureRepository, DRIFTED_DECLARATION } from './helpers.js';

const cli = path.resolve(process.cwd(), 'dist', 'src', 'cli.js');

function run(arguments_: string[], expectedCode: number) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], { encoding: 'utf8' });
  assert.equal(result.status, expectedCode, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

const fixture = await createFixtureRepository();
run(['init', '--root', fixture.root], 0);
const recorded = run(
  [
    'record',
    '--root',
    fixture.root,
    '--project',
    'app',
    '--package',
    '@evidrift/demo-contract',
    '--symbol',
    'parseConfig',
    '--parameter',
    'options',
    '--claim',
    'parseConfig accepts an optional options parameter.',
    '--code',
    'app/src/index.ts:2',
  ],
  0,
);
assert.match(recorded, /Receipt ID: sha256:[a-f0-9]{64}/);
assert.match(run(['check', '--root', fixture.root], 0), /PASS sha256:/);

await writeFile(path.join(fixture.dependency, 'index.d.ts'), DRIFTED_DECLARATION);
const drift = run(['check', '--root', fixture.root], 1);
for (const field of [
  'Claim:',
  'Expected signature:',
  'Current signature:',
  'Affected code location:',
  'Receipt ID:',
  'Action:',
]) {
  assert.match(drift, new RegExp(field));
}
console.log('Smoke test passed: initial check PASS, deterministic signature drift FAIL.');
