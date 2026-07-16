import { readFile } from 'node:fs/promises';

function fail(message) {
  console.error(`Release check failed: ${message}`);
  process.exit(1);
}

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (tag === undefined) {
  fail('provide a tag such as v0.2.0.');
}
if (!/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(tag)) {
  fail(`tag ${tag} is not a stable semantic version.`);
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(
  await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);
const server = JSON.parse(await readFile(new URL('../server.json', import.meta.url), 'utf8'));
const version = tag.slice(1);
const registryPackage = server.packages?.[0];

const checks = [
  ['package.json version', packageJson.version, version],
  ['package-lock.json version', packageLock.version, version],
  ['package-lock root version', packageLock.packages?.['']?.version, version],
  ['server.json version', server.version, version],
  ['server package version', registryPackage?.version, version],
  ['MCP name', packageJson.mcpName, server.name],
  ['MCP npm package', registryPackage?.identifier, packageJson.name],
  ['MCP transport', registryPackage?.transport?.type, 'stdio'],
];

for (const [label, actual, expected] of checks) {
  if (actual !== expected) {
    fail(`${label} is ${String(actual)}; expected ${String(expected)}.`);
  }
}

const arguments_ = registryPackage?.packageArguments;
if (
  !Array.isArray(arguments_) ||
  arguments_.length !== 1 ||
  arguments_[0]?.type !== 'positional' ||
  arguments_[0]?.value !== 'mcp'
) {
  fail('server.json must launch the package through the fixed `mcp` subcommand.');
}

console.log(`Release metadata is aligned at ${tag}.`);
