import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repository = process.cwd();
const cli = path.join(repository, 'dist', 'src', 'cli.js');
const workspace = await mkdtemp(path.join(tmpdir(), 'evidrift-demo-capture-'));
const output = path.join(repository, 'docs', 'assets', 'evidrift-demo-transcript.txt');

try {
  const result = spawnSync(process.execPath, [cli, 'demo', '--root', workspace], {
    cwd: repository,
    encoding: 'utf8',
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(
      `Demo capture failed with exit ${String(result.status)}.\n${result.stdout}\n${result.stderr}`,
    );
  }
  if (
    !result.stdout.includes('PASS sha256:') ||
    !result.stdout.includes('FAIL contract_mismatch')
  ) {
    throw new Error('Demo capture did not contain the deterministic PASS-to-FAIL sequence.');
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, result.stdout.replaceAll('\\', '/').replaceAll('\r\n', '\n'), 'utf8');
  console.log(`Captured real CLI output in ${path.relative(repository, output)}.`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
