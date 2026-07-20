#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkExitCode,
  checkRepository,
  explainEvidence,
  initEvidrift,
  recordEvidence,
  resolveCliProjectRoot,
} from './core.js';
import { runSignatureDriftDemo } from './demo.js';
import { runMcpServer } from './mcp.js';
import { assertSafeRelativePath } from './paths.js';
import { renderCheck, renderDemo, renderExplain, renderRecord, renderResult } from './output.js';
import { renderCheckReport } from './report.js';
import { interactiveTerminalEnabled, withTerminalProgress } from './terminal.js';
import { escapeOutputText } from './text.js';
import { EVIDRIFT_VERSION, type AffectedCode } from './types.js';

const HELP = `Evidrift ${EVIDRIFT_VERSION} - catch API drift in AI-generated code

See deterministic drift in one command (nothing to install globally):
  npx --yes evidrift@latest demo

Usage:
  evidrift init [--root <repo>]
  evidrift record --package <name> --symbol <name> [--parameter <name>] [--overload <number>]
               --claim <text> --code <path[:line]> [--project <path>] [--root <repo>]
  evidrift record --json <path> --pointer <RFC6901> --claim <text> --code <path[:line]>
               [--root <repo>]
  evidrift check [--format text|json] [--root <repo>]
  evidrift diff [--root <repo>]
  evidrift explain <receipt-id> [--root <repo>]
  evidrift demo [--root <directory>]
  evidrift mcp

Exit codes for check: 0 match/warning, 1 contract mismatch, 2 evidence integrity error.`;

interface ParsedArguments {
  command?: string;
  positionals: string[];
  options: Map<string, string>;
  help: boolean;
  version: boolean;
}

type CheckOutputFormat = 'text' | 'json';

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

function positiveIntegerOption(parsed: ParsedArguments, name: string): number | undefined {
  const value = option(parsed, name);
  if (value === undefined) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`Option --${name} must be a positive integer.`);
  }
  const parsedValue = Number(value);
  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(`Option --${name} must be a positive safe integer.`);
  }
  return parsedValue;
}

function checkOutputFormat(parsed: ParsedArguments): CheckOutputFormat {
  const value = option(parsed, 'format') ?? 'text';
  if (value !== 'text' && value !== 'json') {
    throw new Error('Option --format must be text or json.');
  }
  return value;
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArguments(argv);
  const renderOptions = { interactive: interactiveTerminalEnabled() };
  if (parsed.version) {
    console.log(EVIDRIFT_VERSION);
    return 0;
  }
  if (parsed.help || parsed.command === undefined) {
    console.log(HELP);
    return 0;
  }

  const repoRoot = path.resolve(option(parsed, 'root') ?? process.cwd());
  switch (parsed.command) {
    case 'init': {
      ensureOptions(parsed, ['root']);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift init does not accept positional arguments.');
      }
      const created = await initEvidrift(repoRoot);
      console.log(
        [
          created
            ? 'Initialized .evidrift/evidence.lock and .evidrift/receipts/.'
            : 'Evidrift already initialized.',
          '',
          'Next:',
          '  1. Connect your coding agent: https://github.com/bm1016bm-svg/evidrift/blob/main/docs/mcp.md',
          '  2. Let the agent record an assumption through MCP.',
          '  3. Commit .evidrift/ and run `npx evidrift check` in CI.',
          '',
          'Want to see the failure first? Run `npx --yes evidrift@latest demo`.',
        ].join('\n'),
      );
      return 0;
    }
    case 'record': {
      ensureOptions(parsed, [
        'claim',
        'code',
        'json',
        'overload',
        'package',
        'parameter',
        'pointer',
        'project',
        'root',
        'symbol',
      ]);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift record does not accept positional arguments.');
      }
      const claim = option(parsed, 'claim', true);
      const affected = option(parsed, 'code', true);
      if (claim === undefined || affected === undefined) {
        throw new Error('Required record options were not parsed.');
      }
      const affectedCode = parseAffectedCode(affected);
      const jsonPath = option(parsed, 'json');
      const pointer = option(parsed, 'pointer');
      if (jsonPath !== undefined || pointer !== undefined) {
        if (jsonPath === undefined || pointer === undefined) {
          throw new Error('JSON evidence requires both --json and --pointer.');
        }
        for (const incompatible of ['overload', 'package', 'parameter', 'project', 'symbol']) {
          if (option(parsed, incompatible) !== undefined) {
            throw new Error(`--${incompatible} cannot be combined with --json.`);
          }
        }
        const receipt = await recordEvidence({
          repoRoot,
          jsonPath: assertSafeRelativePath(jsonPath, 'JSON source', false),
          pointer,
          claim,
          affectedCode,
        });
        console.log(renderRecord(receipt, renderOptions));
        return 0;
      }

      const packageName = option(parsed, 'package', true);
      const symbol = option(parsed, 'symbol', true);
      if (packageName === undefined || symbol === undefined) {
        throw new Error('Required TypeScript record options were not parsed.');
      }
      const overload = positiveIntegerOption(parsed, 'overload');
      const receipt = await recordEvidence({
        repoRoot,
        projectRoot: resolveCliProjectRoot(repoRoot, option(parsed, 'project') ?? '.'),
        packageName,
        symbol,
        ...(option(parsed, 'parameter') === undefined
          ? {}
          : { parameter: option(parsed, 'parameter') as string }),
        ...(overload === undefined ? {} : { overload }),
        claim,
        affectedCode,
      });
      console.log(renderRecord(receipt, renderOptions));
      return 0;
    }
    case 'check': {
      ensureOptions(parsed, ['format', 'root']);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift check does not accept positional arguments.');
      }
      const format = checkOutputFormat(parsed);
      const results =
        format === 'json'
          ? await checkRepository(repoRoot)
          : await withTerminalProgress('Revalidating Evidrift evidence…', () =>
              checkRepository(repoRoot),
            );
      console.log(
        format === 'json' ? renderCheckReport(results) : renderCheck(results, renderOptions),
      );
      return checkExitCode(results);
    }
    case 'diff': {
      ensureOptions(parsed, ['root']);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift diff does not accept positional arguments.');
      }
      const results = await withTerminalProgress('Comparing Evidrift evidence…', () =>
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
        throw new Error('evidrift explain requires one full receipt ID.');
      }
      const result = await withTerminalProgress('Explaining Evidrift evidence…', () =>
        explainEvidence(repoRoot, parsed.positionals[0] as string),
      );
      console.log(renderExplain(result, renderOptions));
      return 0;
    }
    case 'demo': {
      ensureOptions(parsed, ['root']);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift demo does not accept positional arguments.');
      }
      const result = await withTerminalProgress(
        'Creating the Evidrift signature-drift demo…',
        (report) => runSignatureDriftDemo(repoRoot, report),
      );
      console.log(renderDemo(result, renderOptions));
      return 0;
    }
    case 'mcp': {
      ensureOptions(parsed, []);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift mcp does not accept arguments.');
      }
      await runMcpServer();
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
