#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkExitCode,
  checkRepository,
  explainEvidence,
  initLitmo,
  recordEvidence,
  resolveCliProjectRoot,
} from './core.js';
import { runSignatureDriftDemo } from './demo.js';
import { assertSafeRelativePath } from './paths.js';
import { renderCheck, renderDemo, renderExplain, renderRecord, renderResult } from './output.js';
import { interactiveTerminalEnabled, withTerminalProgress } from './terminal.js';
import { escapeOutputText } from './text.js';
import { LITMO_VERSION, type AffectedCode } from './types.js';

const HELP = `Litmo ${LITMO_VERSION} - the lockfile for AI assumptions

Usage:
  litmo init [--root <repo>]
  litmo record --package <name> --symbol <name> [--parameter <name>]
               --claim <text> --code <path[:line]> [--project <path>] [--root <repo>]
  litmo check [--root <repo>]
  litmo diff [--root <repo>]
  litmo explain <receipt-id> [--root <repo>]
  litmo demo [--root <directory>]

Exit codes for check: 0 match/warning, 1 contract mismatch, 2 evidence integrity error.`;

interface ParsedArguments {
  command?: string;
  positionals: string[];
  options: Map<string, string>;
  help: boolean;
  version: boolean;
}

function parseArguments(argv: string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  let command: string | undefined;
  let help = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === undefined) {
      continue;
    }
    if (item === '--help' || item === '-h') {
      help = true;
      continue;
    }
    if (item === '--version' || item === '-v') {
      version = true;
      continue;
    }
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const value = argv[index + 1];
      if (!key || value === undefined || value.startsWith('--')) {
        throw new Error(`Option ${item} requires a value.`);
      }
      if (options.has(key)) {
        throw new Error(`Option ${item} was provided more than once.`);
      }
      options.set(key, value);
      index += 1;
      continue;
    }
    if (command === undefined) {
      command = item;
    } else {
      positionals.push(item);
    }
  }
  return { ...(command === undefined ? {} : { command }), positionals, options, help, version };
}

function option(parsed: ParsedArguments, name: string, required = false): string | undefined {
  const value = parsed.options.get(name);
  if (required && value === undefined) {
    throw new Error(`Missing required option --${name}.`);
  }
  return value;
}

function ensureOptions(parsed: ParsedArguments, allowed: readonly string[]): void {
  for (const name of parsed.options.keys()) {
    if (!allowed.includes(name)) {
      throw new Error(`Unknown option --${name}.`);
    }
  }
}

function parseAffectedCode(value: string): AffectedCode {
  const match = /^(.*?)(?::([1-9][0-9]*))?$/.exec(value);
  if (!match?.[1]) {
    throw new Error('--code must be a repository-relative path with an optional positive line.');
  }
  const safePath = assertSafeRelativePath(match[1], 'Affected code', false);
  return match[2] === undefined ? { path: safePath } : { path: safePath, line: Number(match[2]) };
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArguments(argv);
  const renderOptions = { interactive: interactiveTerminalEnabled() };
  if (parsed.version) {
    console.log(LITMO_VERSION);
    return 0;
  }
  if (parsed.help || parsed.command === undefined) {
    console.log(HELP);
    return parsed.help ? 0 : 2;
  }

  const repoRoot = path.resolve(option(parsed, 'root') ?? process.cwd());
  switch (parsed.command) {
    case 'init': {
      ensureOptions(parsed, ['root']);
      if (parsed.positionals.length > 0) {
        throw new Error('litmo init does not accept positional arguments.');
      }
      const created = await initLitmo(repoRoot);
      console.log(
        created
          ? 'Initialized .litmo/evidence.lock and .litmo/receipts/.'
          : 'Litmo already initialized.',
      );
      return 0;
    }
    case 'record': {
      ensureOptions(parsed, ['claim', 'code', 'package', 'parameter', 'project', 'root', 'symbol']);
      if (parsed.positionals.length > 0) {
        throw new Error('litmo record does not accept positional arguments.');
      }
      const packageName = option(parsed, 'package', true);
      const symbol = option(parsed, 'symbol', true);
      const claim = option(parsed, 'claim', true);
      const affected = option(parsed, 'code', true);
      if (
        packageName === undefined ||
        symbol === undefined ||
        claim === undefined ||
        affected === undefined
      ) {
        throw new Error('Required record options were not parsed.');
      }
      const receipt = await recordEvidence({
        repoRoot,
        projectRoot: resolveCliProjectRoot(repoRoot, option(parsed, 'project') ?? '.'),
        packageName,
        symbol,
        ...(option(parsed, 'parameter') === undefined
          ? {}
          : { parameter: option(parsed, 'parameter') as string }),
        claim,
        affectedCode: parseAffectedCode(affected),
      });
      console.log(renderRecord(receipt, renderOptions));
      return 0;
    }
    case 'check': {
      ensureOptions(parsed, ['root']);
      if (parsed.positionals.length > 0) {
        throw new Error('litmo check does not accept positional arguments.');
      }
      const results = await withTerminalProgress('Revalidating Litmo evidence…', () =>
        checkRepository(repoRoot),
      );
      console.log(renderCheck(results, renderOptions));
      return checkExitCode(results);
    }
    case 'diff': {
      ensureOptions(parsed, ['root']);
      if (parsed.positionals.length > 0) {
        throw new Error('litmo diff does not accept positional arguments.');
      }
      const results = await withTerminalProgress('Comparing Litmo evidence…', () =>
        checkRepository(repoRoot),
      );
      const changed = results.filter((result) => result.status !== 'pass');
      console.log(
        changed.length === 0
          ? 'No evidence drift.'
          : changed.map((result) => renderResult(result, renderOptions)).join('\n\n'),
      );
      return results.some((result) => result.status === 'integrity_error') ? 2 : 0;
    }
    case 'explain': {
      ensureOptions(parsed, ['root']);
      if (parsed.positionals.length !== 1 || parsed.positionals[0] === undefined) {
        throw new Error('litmo explain requires one full receipt ID.');
      }
      const result = await withTerminalProgress('Explaining Litmo evidence…', () =>
        explainEvidence(repoRoot, parsed.positionals[0] as string),
      );
      console.log(renderExplain(result, renderOptions));
      return 0;
    }
    case 'demo': {
      ensureOptions(parsed, ['root']);
      if (parsed.positionals.length > 0) {
        throw new Error('litmo demo does not accept positional arguments.');
      }
      const result = await withTerminalProgress(
        'Creating the Litmo signature-drift demo…',
        (report) => runSignatureDriftDemo(repoRoot, report),
      );
      console.log(renderDemo(result, renderOptions));
      return 0;
    }
    default:
      throw new Error(`Unknown command ${parsed.command}.`);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(
        `ERROR: ${escapeOutputText(error instanceof Error ? error.message : String(error))}`,
      );
      process.exitCode = 2;
    });
}
