import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isInside } from './paths.js';
import { EVIDRIFT_VERSION } from './types.js';

const PACKAGE_JSON_LIMIT = 1024 * 1024;
const WORKFLOW_RELATIVE_PATH = '.github/workflows/evidrift.yml';
const CHECKOUT_SHA = 'de0fac2e4500dabe0009e67214ff5f5447ce83dd';
const SETUP_NODE_SHA = '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e';

type PackageManager = 'npm' | 'pnpm' | 'yarn';
type FileStatus = 'created' | 'unchanged' | 'preserved';

export interface GitHubActionsInitResult {
  packageManager: PackageManager;
  packageScript: FileStatus;
  workflow: FileStatus;
  workflowPath: typeof WORKFLOW_RELATIVE_PATH;
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function regularFileExists(filePath: string): Promise<boolean> {
  try {
    const metadata = await lstat(filePath);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
}

async function readSafeFile(repoRoot: string, filePath: string, label: string): Promise<string> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symlink.`);
  }
  const resolved = await realpath(filePath);
  if (!isInside(repoRoot, resolved)) {
    throw new Error(`${label} resolves outside the repository.`);
  }
  if (metadata.size > PACKAGE_JSON_LIMIT) {
    throw new Error(`${label} exceeds the ${PACKAGE_JSON_LIMIT}-byte limit.`);
  }
  return readFile(resolved, 'utf8');
}

async function ensureSafeDirectory(repoRoot: string, relativePath: string): Promise<string> {
  let current = repoRoot;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`${relativePath} must contain only real directories.`);
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
      await mkdir(current);
    }
    const resolved = await realpath(current);
    if (!isInside(repoRoot, resolved)) {
      throw new Error(`${relativePath} resolves outside the repository.`);
    }
  }
  return current;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, filePath);
}

function parsePackageJson(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    throw new Error('package.json must contain valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('package.json must contain a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

async function detectPackageManager(
  repoRoot: string,
  manifest: Record<string, unknown>,
): Promise<{ manager: PackageManager; locked: boolean; yarnModern: boolean }> {
  const declared =
    typeof manifest.packageManager === 'string'
      ? /^(npm|pnpm|yarn|bun)@/u.exec(manifest.packageManager)?.[1]
      : undefined;
  if (typeof manifest.packageManager === 'string' && declared === undefined) {
    throw new Error('packageManager must select npm, pnpm, Yarn, or Bun with a version.');
  }
  if (declared === 'bun') {
    throw new Error('GitHub Actions init currently supports npm, pnpm, or Yarn, not Bun.');
  }

  const lockfiles = await Promise.all(
    [
      ['npm', 'package-lock.json'],
      ['npm', 'npm-shrinkwrap.json'],
      ['pnpm', 'pnpm-lock.yaml'],
      ['yarn', 'yarn.lock'],
      ['bun', 'bun.lock'],
      ['bun', 'bun.lockb'],
    ].map(async ([manager, name]) => ({
      manager,
      exists: await regularFileExists(path.join(repoRoot, name as string)),
    })),
  );
  const detected = [
    ...new Set(lockfiles.filter((entry) => entry.exists).map((entry) => entry.manager)),
  ];
  if (detected.includes('bun')) {
    throw new Error('GitHub Actions init currently supports npm, pnpm, or Yarn, not Bun.');
  }

  const manager = declared ?? (detected.length === 1 ? detected[0] : undefined) ?? 'npm';
  if (manager !== 'npm' && manager !== 'pnpm' && manager !== 'yarn') {
    throw new Error('packageManager must select npm, pnpm, or Yarn.');
  }
  if (declared === undefined && detected.length > 1) {
    throw new Error(
      'Multiple package-manager lockfiles found; set packageManager in package.json.',
    );
  }

  const locked = lockfiles.some((entry) => entry.manager === manager && entry.exists);
  const yarnVersion =
    manager === 'yarn' && typeof manifest.packageManager === 'string'
      ? Number(/^yarn@([0-9]+)/u.exec(manifest.packageManager)?.[1])
      : undefined;
  return {
    manager,
    locked,
    yarnModern: yarnVersion !== undefined && yarnVersion >= 2,
  };
}

function installSteps(manager: PackageManager, locked: boolean, yarnModern: boolean): string[] {
  if (manager === 'npm') {
    return [
      '      - name: Install locked dependencies',
      `        run: ${locked ? 'npm ci' : 'npm install'} --ignore-scripts`,
    ];
  }

  const install =
    manager === 'pnpm'
      ? `pnpm install${locked ? ' --frozen-lockfile' : ''} --ignore-scripts`
      : yarnModern
        ? `yarn install${locked ? ' --immutable' : ''} --mode=skip-builds`
        : `yarn install${locked ? ' --frozen-lockfile' : ''} --ignore-scripts`;
  return [
    '      - name: Enable Corepack',
    '        run: corepack enable',
    '',
    '      - name: Install locked dependencies',
    `        run: ${install}`,
  ];
}

function renderWorkflow(manager: PackageManager, locked: boolean, yarnModern: boolean): string {
  return [
    'name: Evidrift',
    '',
    'on:',
    '  pull_request:',
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  check:',
    '    name: Contract drift',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 10',
    '    steps:',
    '      - name: Check out repository',
    `        uses: actions/checkout@${CHECKOUT_SHA} # v6.0.2`,
    '',
    '      - name: Set up Node.js',
    `        uses: actions/setup-node@${SETUP_NODE_SHA} # v6.4.0`,
    '        with:',
    '          node-version: 22',
    '          package-manager-cache: false',
    '',
    ...installSteps(manager, locked, yarnModern),
    '',
    '      - name: Revalidate Evidrift receipts',
    `        uses: bm1016bm-svg/evidrift@v${EVIDRIFT_VERSION}`,
    '        with:',
    '          annotations: github',
    '',
  ].join('\n');
}

function serializedPackageJson(
  source: string,
  manifest: Record<string, unknown>,
): { content: string; status: FileStatus } {
  const command = `npx --yes evidrift@${EVIDRIFT_VERSION} check`;
  const existingScripts = manifest.scripts;
  if (
    existingScripts !== undefined &&
    (existingScripts === null ||
      typeof existingScripts !== 'object' ||
      Array.isArray(existingScripts))
  ) {
    throw new Error('package.json scripts must be a JSON object.');
  }
  const scripts = (existingScripts ?? {}) as Record<string, unknown>;
  if (scripts['evidrift:check'] !== undefined) {
    return {
      content: source,
      status: scripts['evidrift:check'] === command ? 'unchanged' : 'preserved',
    };
  }

  manifest.scripts = { ...scripts, 'evidrift:check': command };
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const indentation = /\r?\n([ \t]+)"/u.exec(source)?.[1] ?? '  ';
  const content = `${JSON.stringify(manifest, null, indentation).replaceAll('\n', newline)}${newline}`;
  return { content, status: 'created' };
}

export async function configureGitHubActions(
  repoRootInput: string,
): Promise<GitHubActionsInitResult> {
  const repoRoot = await realpath(repoRootInput);
  const packagePath = path.join(repoRoot, 'package.json');
  const packageSource = await readSafeFile(repoRoot, packagePath, 'package.json');
  const manifest = parsePackageJson(packageSource);
  const packageManager = await detectPackageManager(repoRoot, manifest);
  const packageUpdate = serializedPackageJson(packageSource, manifest);
  const workflow = renderWorkflow(
    packageManager.manager,
    packageManager.locked,
    packageManager.yarnModern,
  );

  const workflowsDirectory = await ensureSafeDirectory(repoRoot, '.github/workflows');
  const workflowPath = path.join(workflowsDirectory, 'evidrift.yml');
  let workflowStatus: FileStatus = 'created';
  try {
    const existing = await readSafeFile(repoRoot, workflowPath, WORKFLOW_RELATIVE_PATH);
    workflowStatus = existing === workflow ? 'unchanged' : 'preserved';
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }

  if (packageUpdate.status === 'created') {
    await atomicWrite(packagePath, packageUpdate.content);
  }
  if (workflowStatus === 'created') {
    await atomicWrite(workflowPath, workflow);
  }

  return {
    packageManager: packageManager.manager,
    packageScript: packageUpdate.status,
    workflow: workflowStatus,
    workflowPath: WORKFLOW_RELATIVE_PATH,
  };
}
