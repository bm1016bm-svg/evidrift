import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const actionRoot = fileURLToPath(new URL('..', import.meta.url));
const version = manifest.version;
if (!/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(version)) {
  throw new Error('Action source package.json contains an invalid stable version.');
}

const format = process.env.EVIDRIFT_ACTION_FORMAT ?? 'text';
if (format !== 'text' && format !== 'json') {
  throw new Error('Action input format must be text or json.');
}
const annotations = process.env.EVIDRIFT_ACTION_ANNOTATIONS ?? 'github';
if (annotations !== 'github' && annotations !== 'none') {
  throw new Error('Action input annotations must be github or none.');
}
const root = process.env.EVIDRIFT_ACTION_ROOT ?? '.';
if (!root || /[\u0000-\u001f\u007f-\u009f]/u.test(root)) {
  throw new Error('Action input root must be non-empty and contain no control characters.');
}
if (path.isAbsolute(root)) {
  throw new Error('Action input root must be repository-relative.');
}
const workspace = process.env.GITHUB_WORKSPACE;
if (workspace === undefined || !path.isAbsolute(workspace)) {
  throw new Error('GITHUB_WORKSPACE must be an absolute path.');
}
const workspaceRoot = path.resolve(workspace);
const targetRoot = path.resolve(workspaceRoot, root);
const relativeTarget = path.relative(workspaceRoot, targetRoot);
if (
  relativeTarget === '..' ||
  relativeTarget.startsWith(`..${path.sep}`) ||
  path.isAbsolute(relativeTarget)
) {
  throw new Error('Action input root must stay inside GITHUB_WORKSPACE.');
}

const nodeDirectory = path.dirname(process.execPath);
const npmCli = [
  path.join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  path.resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
].find((candidate) => existsSync(candidate));
if (npmCli === undefined) {
  throw new Error('The Node.js installation must include npm.');
}
const result = spawnSync(
  process.execPath,
  [
    npmCli,
    'exec',
    '--yes',
    '--ignore-scripts',
    '--registry=https://registry.npmjs.org/',
    '--package',
    `evidrift@${version}`,
    '--',
    'evidrift',
    'check',
    '--root',
    targetRoot,
    '--format',
    format,
    '--annotations',
    annotations,
  ],
  {
    cwd: actionRoot,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true',
      npm_config_registry: 'https://registry.npmjs.org/',
    },
    stdio: 'inherit',
    shell: false,
  },
);
if (result.error !== undefined) {
  throw result.error;
}
process.exitCode = result.status ?? 2;
