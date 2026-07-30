#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { renderGitHubAnnotations } from './annotations.js';
import {
  checkExitCode,
  checkRepository,
  explainEvidence,
  initEvidrift,
  recordEvidence,
  resolveCliProjectRoot,
} from './core.js';
import { runSignatureDriftDemo } from './demo.js';
import { configureGitHubActions } from './github-actions.js';
import { runMcpServer } from './mcp.js';
import {
  renderCheck,
  renderDemo,
  renderExplain,
  renderMinimize,
  renderRecord,
  renderReproMinDemo,
  renderReproductionVerification,
  renderResult,
} from './output.js';
import { assertSafeRelativePath } from './paths.js';
import { renderCheckReport } from './report.js';
import { runReproMinDemo } from './repro-demo.js';
import {
  minimizeHttpReproduction,
  readReproductionArtifact,
  readRequestFixture,
  verifyHttpReproduction,
  writeReproductionArtifact,
  type FailurePredicate,
} from './repro-http.js';
import { ReproductionMismatchError, type JsonValue } from './repro.js';
import { interactiveTerminalEnabled, withTerminalProgress } from './terminal.js';
import { escapeOutputText } from './text.js';
import { EVIDRIFT_VERSION, type AffectedCode } from './types.js';

const HELP = `Evidrift ${EVIDRIFT_VERSION} - replay-verified JSON reductions and API drift evidence

See a replay-verified JSON reduction in one command:
  npx --yes evidrift@latest repro-demo

See deterministic drift in one command:
  npx --yes evidrift@latest demo

Usage:
  evidrift init [--github-actions] [--root <repo>]
  evidrift record --package <name> --symbol <name> [--parameter <name>] [--overload <number>]
               --claim <text> --code <path[:line]> [--project <path>] [--root <repo>]
  evidrift record --json <path> --pointer <RFC6901> --claim <text> --code <path[:line]>
               [--root <repo>]
  evidrift check [--format text|json] [--annotations none|github] [--root <repo>]
  evidrift diff [--root <repo>]
  evidrift explain <receipt-id> [--root <repo>]
  evidrift demo [--root <directory>]
  evidrift minimize --request <json> --status <code>
                    (--response-contains <text> | --response-pointer <RFC6901>
                     --response-equals <json>)
                    --output <json> --confirm-replay yes
                    [--max-probes <number>] [--timeout-ms <number>] [--root <repo>]
  evidrift reproduce --artifact <json> --confirm-replay yes
                     [--timeout-ms <number>] [--root <repo>]
  evidrift repro-demo
  evidrift mcp

Exit codes: 0 success/match, 1 selected predicate or contract mismatch, 2 invalid or unavailable evidence.`;

interface ParsedArguments {
  command?: string;
  positionals: string[];
  options: Map<string, string>;
  flags: Set<string>;
  help: boolean;
  version: boolean;
}

type CheckOutputFormat = 'text' | 'json';
type CheckAnnotations = 'none' | 'github';

const VALUELESS_FLAGS = new Set(['github-actions']);

function parseArguments(argv: string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
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
      if (VALUELESS_FLAGS.has(key)) {
        if (flags.has(key)) {
          throw new Error(`Option ${item} was provided more than once.`);
        }
        flags.add(key);
        continue;
      }
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
  return {
    ...(command === undefined ? {} : { command }),
    positionals,
    options,
    flags,
    help,
    version,
  };
}

function option(parsed: ParsedArguments, name: string, required = false): string | undefined {
  const value = parsed.options.get(name);
  if (required && value === undefined) {
    throw new Error(`Missing required option --${name}.`);
  }
  return value;
}

function ensureOptions(
  parsed: ParsedArguments,
  allowed: readonly string[],
  allowedFlags: readonly string[] = [],
): void {
  for (const name of parsed.options.keys()) {
    if (!allowed.includes(name)) {
      throw new Error(`Unknown option --${name}.`);
    }
  }
  for (const name of parsed.flags) {
    if (!allowedFlags.includes(name)) {
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

function checkAnnotations(parsed: ParsedArguments): CheckAnnotations {
  const value = option(parsed, 'annotations') ?? 'none';
  if (value !== 'none' && value !== 'github') {
    throw new Error('Option --annotations must be none or github.');
  }
  return value;
}

function boundedIntegerOption(
  parsed: ParsedArguments,
  name: string,
  minimum: number,
  maximum: number,
  required = false,
): number | undefined {
  const raw = option(parsed, name, required);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^[0-9]+$/u.test(raw)) {
    throw new Error(`Option --${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Option --${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function replayConfirmation(parsed: ParsedArguments): true {
  if (option(parsed, 'confirm-replay', true) !== 'yes') {
    throw new Error('Option --confirm-replay must be exactly yes.');
  }
  return true;
}

function failurePredicate(parsed: ParsedArguments): FailurePredicate {
  const status = boundedIntegerOption(parsed, 'status', 100, 599, true);
  if (status === undefined) {
    throw new Error('Required status was not parsed.');
  }
  const responseContains = option(parsed, 'response-contains');
  const responsePointer = option(parsed, 'response-pointer');
  const responseEquals = option(parsed, 'response-equals');
  if (responseContains !== undefined) {
    if (responsePointer !== undefined || responseEquals !== undefined) {
      throw new Error(
        '--response-contains cannot be combined with --response-pointer or --response-equals.',
      );
    }
    return { status, responseContains };
  }
  if (responsePointer === undefined || responseEquals === undefined) {
    throw new Error(
      'Provide --response-contains or both --response-pointer and --response-equals.',
    );
  }
  let expected: unknown;
  try {
    expected = JSON.parse(responseEquals);
  } catch {
    throw new Error('--response-equals must be a valid JSON value.');
  }
  return { status, responsePointer, responseEquals: expected as JsonValue };
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
      ensureOptions(parsed, ['root'], ['github-actions']);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift init does not accept positional arguments.');
      }
      const created = await initEvidrift(repoRoot);
      const githubActions = parsed.flags.has('github-actions')
        ? await configureGitHubActions(repoRoot)
        : undefined;
      console.log(
        [
          created
            ? 'Initialized .evidrift/evidence.lock and .evidrift/receipts/.'
            : 'Evidrift already initialized.',
          ...(githubActions === undefined
            ? []
            : [
                `GitHub Actions: ${githubActions.workflow} ${githubActions.workflowPath}.`,
                `Package script: ${githubActions.packageScript} scripts.evidrift:check (${githubActions.packageManager}).`,
                ...(githubActions.workflow === 'preserved'
                  ? ['Existing workflow was preserved; add the Evidrift step manually.']
                  : []),
                ...(githubActions.packageScript === 'preserved'
                  ? ['Existing scripts.evidrift:check was preserved.']
                  : []),
              ]),
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
      ensureOptions(parsed, ['annotations', 'format', 'root']);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift check does not accept positional arguments.');
      }
      const format = checkOutputFormat(parsed);
      const annotations = checkAnnotations(parsed);
      const results =
        format === 'json'
          ? await checkRepository(repoRoot)
          : await withTerminalProgress('Revalidating Evidrift evidence…', () =>
              checkRepository(repoRoot),
            );
      const renderedAnnotations = annotations === 'github' ? renderGitHubAnnotations(results) : '';
      if (renderedAnnotations.length > 0) {
        if (format === 'json') {
          console.error(renderedAnnotations);
        } else {
          console.log(renderedAnnotations);
        }
      }
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
    case 'minimize': {
      ensureOptions(parsed, [
        'confirm-replay',
        'max-probes',
        'output',
        'request',
        'response-contains',
        'response-equals',
        'response-pointer',
        'root',
        'status',
        'timeout-ms',
      ]);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift minimize does not accept positional arguments.');
      }
      const requestPath = option(parsed, 'request', true);
      const outputPath = option(parsed, 'output', true);
      if (requestPath === undefined || outputPath === undefined) {
        throw new Error('Required minimize paths were not parsed.');
      }
      const maxProbes = boundedIntegerOption(parsed, 'max-probes', 2, 500);
      const timeoutMs = boundedIntegerOption(parsed, 'timeout-ms', 100, 30_000);
      const fixture = await readRequestFixture(repoRoot, requestPath);
      let artifact;
      try {
        artifact = await withTerminalProgress('Minimizing the verified loopback failure…', () =>
          minimizeHttpReproduction(fixture, failurePredicate(parsed), {
            confirmReplay: replayConfirmation(parsed),
            ...(maxProbes === undefined ? {} : { maxProbes }),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          }),
        );
      } catch (error) {
        if (error instanceof ReproductionMismatchError) {
          console.log(`MISMATCH ${escapeOutputText(error.message)}`);
          return 1;
        }
        throw error;
      }
      const written = await writeReproductionArtifact(repoRoot, outputPath, artifact);
      console.log(renderMinimize(artifact, written));
      return 0;
    }
    case 'reproduce': {
      ensureOptions(parsed, ['artifact', 'confirm-replay', 'root', 'timeout-ms']);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift reproduce does not accept positional arguments.');
      }
      const artifactPath = option(parsed, 'artifact', true);
      if (artifactPath === undefined) {
        throw new Error('Required artifact path was not parsed.');
      }
      const timeoutMs = boundedIntegerOption(parsed, 'timeout-ms', 100, 30_000);
      const artifact = await readReproductionArtifact(repoRoot, artifactPath);
      const verification = await withTerminalProgress(
        'Replaying the minimized loopback failure once…',
        () =>
          verifyHttpReproduction(artifact, {
            confirmReplay: replayConfirmation(parsed),
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
          }),
      );
      console.log(renderReproductionVerification(verification.artifact, verification.observation));
      return verification.observation.matched ? 0 : 1;
    }
    case 'repro-demo': {
      ensureOptions(parsed, []);
      if (parsed.positionals.length > 0) {
        throw new Error('evidrift repro-demo does not accept arguments.');
      }
      const artifact = await withTerminalProgress(
        'Reducing a verified failure against a disposable loopback server…',
        () => runReproMinDemo(),
      );
      console.log(renderReproMinDemo(artifact));
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
