import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repository = await realpath(process.cwd());
const demoParent = path.join(repository, '.litmo-demo');
const demoRoot = path.join(repository, '.litmo-demo', 'signature-drift');
const appRoot = path.join(demoRoot, 'app');
const dependencyRoot = path.join(appRoot, 'node_modules', '@litmo', 'demo-contract');
const fixtureRoot = path.join(repository, 'examples', 'signature-drift', 'fixture-package');
const driftDeclaration = path.join(
  repository,
  'examples',
  'signature-drift',
  'drift',
  'index.d.ts',
);
const cli = path.join(repository, 'dist', 'src', 'cli.js');

function isMissing(error) {
  return error !== null && typeof error === 'object' && error.code === 'ENOENT';
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function assertRealDirectoryIfPresent(directory, label) {
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink or junction.`);
  }
  if (!isInside(repository, await realpath(directory))) {
    throw new Error(`${label} resolves outside the repository.`);
  }
}

async function assertSafeDemoCleanup() {
  await assertRealDirectoryIfPresent(demoParent, '.litmo-demo');
  await assertRealDirectoryIfPresent(demoRoot, '.litmo-demo/signature-drift');
}

async function setup() {
  await assertSafeDemoCleanup();
  await rm(demoRoot, { recursive: true, force: true });
  await mkdir(path.join(appRoot, 'src'), { recursive: true });
  await mkdir(dependencyRoot, { recursive: true });
  await cp(fixtureRoot, dependencyRoot, { recursive: true });
  await cp(
    path.join(repository, 'examples', 'signature-drift', 'app', 'src', 'index.ts'),
    path.join(appRoot, 'src', 'index.ts'),
  );
  const appPackage = JSON.parse(
    await readFile(
      path.join(repository, 'examples', 'signature-drift', 'app', 'package.json'),
      'utf8',
    ),
  );
  appPackage.dependencies = { '@litmo/demo-contract': '1.0.0' };
  await writeFile(path.join(appRoot, 'package.json'), `${JSON.stringify(appPackage, null, 2)}\n`);
  console.log(`Demo workspace: ${path.relative(repository, demoRoot)}`);
}

async function drift() {
  await cp(driftDeclaration, path.join(dependencyRoot, 'index.d.ts'));
  console.log('Changed fixture signature: options is now required.');
}

function runCli(arguments_, expectedCode = 0) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: repository,
    encoding: 'utf8',
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== expectedCode) {
    throw new Error(
      `litmo ${arguments_.join(' ')} exited ${result.status}; expected ${expectedCode}`,
    );
  }
}

async function run() {
  await setup();
  runCli(['init', '--root', demoRoot]);
  runCli([
    'record',
    '--root',
    demoRoot,
    '--project',
    'app',
    '--package',
    '@litmo/demo-contract',
    '--symbol',
    'parseConfig',
    '--parameter',
    'options',
    '--claim',
    'parseConfig accepts an optional options parameter used by the demo.',
    '--code',
    'app/src/index.ts:3',
  ]);
  runCli(['check', '--root', demoRoot]);
  await drift();
  runCli(['check', '--root', demoRoot], 1);
}

async function main() {
  const command = process.argv[2] ?? 'run';
  if (command === 'setup') {
    await setup();
  } else if (command === 'drift') {
    await drift();
  } else if (command === 'run') {
    await run();
  } else {
    throw new Error(`Unknown demo command: ${command}`);
  }
}

try {
  await main();
} catch (error) {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /[\u0000-\u001f\u007f-\u009f]/gu,
    '?',
  );
  console.error(`Demo refused: ${message}`);
  process.exitCode = 1;
}
