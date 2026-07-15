import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { checkRepository, initEvidrift, recordEvidence } from './core.js';
import { isInside } from './paths.js';
import type { ProgressReporter } from './terminal.js';
import type { CheckResult, Receipt } from './types.js';

const DEMO_MARKER = 'evidrift-generated-signature-drift-demo-v1\n';
const BASE_DECLARATION = `export interface ParseOptions { strict?: boolean; }
export interface ParseResult { value: string; }
export declare function parseConfig(input: string, options?: ParseOptions): ParseResult;
`;
const DRIFTED_DECLARATION = `export interface ParseOptions { strict?: boolean; }
export interface ParseResult { value: string; }
export declare function parseConfig(input: string, options: ParseOptions): ParseResult;
`;

export interface DemoResult {
  workspace: string;
  receipt: Receipt;
  baseline: CheckResult[];
  drift: CheckResult[];
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function assertRealDirectoryIfPresent(
  repository: string,
  directory: string,
  label: string,
): Promise<boolean> {
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink or junction.`);
  }
  if (!isInside(repository, await realpath(directory))) {
    throw new Error(`${label} resolves outside the selected root.`);
  }
  return true;
}

async function assertGeneratedWorkspace(demoRoot: string): Promise<void> {
  const marker = path.join(demoRoot, '.evidrift-generated');
  let metadata;
  try {
    metadata = await lstat(marker);
  } catch {
    throw new Error(
      'Existing .evidrift-demo/signature-drift is not marked as Evidrift-generated; refusing to delete it.',
    );
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (await readFile(marker, 'utf8')) !== DEMO_MARKER
  ) {
    throw new Error(
      'Existing .evidrift-demo/signature-drift is not marked as Evidrift-generated; refusing to delete it.',
    );
  }
}

async function prepareWorkspace(repository: string): Promise<{
  demoRoot: string;
  appRoot: string;
  declaration: string;
}> {
  const demoParent = path.join(repository, '.evidrift-demo');
  const demoRoot = path.join(demoParent, 'signature-drift');
  const parentExists = await assertRealDirectoryIfPresent(repository, demoParent, '.evidrift-demo');
  const demoExists = parentExists
    ? await assertRealDirectoryIfPresent(repository, demoRoot, '.evidrift-demo/signature-drift')
    : false;
  if (demoExists) {
    await assertGeneratedWorkspace(demoRoot);
    await rm(demoRoot, { recursive: true, force: true });
  }

  const appRoot = path.join(demoRoot, 'app');
  const dependencyRoot = path.join(appRoot, 'node_modules', '@evidrift', 'demo-contract');
  const declaration = path.join(dependencyRoot, 'index.d.ts');
  await mkdir(path.join(appRoot, 'src'), { recursive: true });
  await mkdir(dependencyRoot, { recursive: true });
  await writeFile(path.join(demoRoot, '.evidrift-generated'), DEMO_MARKER);
  await writeFile(
    path.join(appRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'evidrift-signature-drift-demo',
        private: true,
        type: 'module',
        dependencies: { '@evidrift/demo-contract': '1.0.0' },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(appRoot, 'src', 'index.ts'),
    [
      "import { parseConfig } from '@evidrift/demo-contract';",
      'const options = { strict: true } as const;',
      "export const parsed = parseConfig('demo', options);",
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(dependencyRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: '@evidrift/demo-contract',
        version: '1.0.0',
        type: 'module',
        types: 'index.d.ts',
        main: 'index.js',
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(declaration, BASE_DECLARATION);
  await writeFile(
    path.join(dependencyRoot, 'index.js'),
    'export function parseConfig(input) { return { value: input }; }\n',
  );
  return { demoRoot, appRoot, declaration };
}

export async function runSignatureDriftDemo(
  repositoryInput: string,
  report: ProgressReporter = () => undefined,
): Promise<DemoResult> {
  const repository = await realpath(repositoryInput);
  report('Creating a safe local fixture…');
  const workspace = await prepareWorkspace(repository);

  report('Recording the dependency assumption…');
  await initEvidrift(workspace.demoRoot);
  const receipt = await recordEvidence({
    repoRoot: workspace.demoRoot,
    projectRoot: workspace.appRoot,
    packageName: '@evidrift/demo-contract',
    symbol: 'parseConfig',
    parameter: 'options',
    claim: 'parseConfig accepts the optional options parameter used by this demo.',
    affectedCode: { path: 'app/src/index.ts', line: 3 },
  });

  report('Checking the unchanged signature…');
  const baseline = await checkRepository(workspace.demoRoot);
  if (baseline.length !== 1 || baseline[0]?.status !== 'pass') {
    throw new Error('Demo baseline did not produce the expected deterministic PASS.');
  }

  report('Changing the dependency signature on purpose…');
  await writeFile(workspace.declaration, DRIFTED_DECLARATION);
  const drift = await checkRepository(workspace.demoRoot);
  if (drift.length !== 1 || drift[0]?.status !== 'contract_mismatch') {
    throw new Error('Demo drift did not produce the expected deterministic mismatch.');
  }

  return {
    workspace: path.relative(repository, workspace.demoRoot),
    receipt,
    baseline,
    drift,
  };
}
