import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';

export const BASELINE_DECLARATION = `export interface ParseOptions { strict?: boolean; }
export interface ParseResult { value: string; }
export declare function parseConfig(input: string, options?: ParseOptions): ParseResult;
`;

export const DRIFTED_DECLARATION = `export interface ParseOptions { strict?: boolean; }
export interface ParseResult { value: string; }
export declare function parseConfig(input: string, options: ParseOptions): ParseResult;
`;

export interface FixtureRepository {
  root: string;
  app: string;
  dependency: string;
}

export async function createFixtureRepository(): Promise<FixtureRepository> {
  const root = await mkdtemp(path.join(tmpdir(), 'litmo-test-'));
  const app = path.join(root, 'app');
  const dependency = path.join(app, 'node_modules', '@litmo', 'demo-contract');
  await mkdir(path.join(app, 'src'), { recursive: true });
  await mkdir(dependency, { recursive: true });
  await writeFile(
    path.join(app, 'package.json'),
    `${JSON.stringify({ name: 'fixture-app', version: '0.0.0', private: true }, null, 2)}\n`,
  );
  await writeFile(
    path.join(dependency, 'package.json'),
    `${JSON.stringify(
      {
        name: '@litmo/demo-contract',
        version: '1.0.0',
        type: 'module',
        main: 'index.js',
        types: 'index.d.ts',
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(path.join(dependency, 'index.d.ts'), BASELINE_DECLARATION);
  await writeFile(
    path.join(dependency, 'index.js'),
    'export function parseConfig(input) { return { value: input }; }\n',
  );
  await writeFile(
    path.join(app, 'src', 'index.ts'),
    "import { parseConfig } from '@litmo/demo-contract';\nparseConfig('x', { strict: true });\n",
  );
  return { root, app, dependency };
}

export async function changeFixtureVersion(dependency: string, version: string): Promise<void> {
  const packagePath = path.join(dependency, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
  packageJson.version = version;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}
