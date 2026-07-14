import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

import { sha256 } from '../canonical.js';
import { isInside, relativeToRepo } from '../paths.js';
import type { ResolvedTypeScriptSymbol } from '../types.js';

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_DECLARATION_BYTES = 2 * 1024 * 1024;

export class AdapterError extends Error {
  override name = 'AdapterError';
}

export class ContractMismatchError extends AdapterError {
  override name = 'ContractMismatchError';

  constructor(
    message: string,
    readonly currentSignature: string,
  ) {
    super(message);
  }
}

async function readLimited(filePath: string, maxBytes: number): Promise<string> {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size > maxBytes) {
    throw new AdapterError(`Evidence source is not a regular file under ${maxBytes} bytes.`);
  }
  return readFile(filePath, 'utf8');
}

function parsePackageJson(raw: string, packageJsonPath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AdapterError(`Invalid package.json at ${packageJsonPath}.`);
  }
}

async function findPackageJson(projectRoot: string, packageName: string): Promise<string> {
  const projectPackage = path.join(projectRoot, 'package.json');
  try {
    await stat(projectPackage);
  } catch {
    throw new AdapterError(`Project package.json not found at ${projectPackage}.`);
  }

  const requireFromProject = createRequire(projectPackage);
  try {
    return requireFromProject.resolve(`${packageName}/package.json`);
  } catch {
    let entry: string;
    try {
      entry = requireFromProject.resolve(packageName);
    } catch {
      throw new AdapterError(`Installed dependency ${packageName} could not be resolved.`);
    }

    let directory = path.dirname(entry);
    while (true) {
      const candidate = path.join(directory, 'package.json');
      try {
        const parsed = parsePackageJson(
          await readLimited(candidate, MAX_PACKAGE_JSON_BYTES),
          candidate,
        );
        if (parsed.name === packageName) {
          return candidate;
        }
      } catch (error) {
        if (error instanceof AdapterError && error.message.startsWith('Invalid package.json')) {
          throw error;
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
    throw new AdapterError(`package.json for ${packageName} could not be located.`);
  }
}

function normalizeSignature(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*([,:?()<>|&])\s*/g, '$1')
    .trim();
}

function diagnosticText(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
}

export interface ResolveTypeScriptSymbolInput {
  repoRoot: string;
  projectRoot: string;
  packageName: string;
  symbol: string;
  parameter?: string;
}

export async function resolveTypeScriptSymbol(
  input: ResolveTypeScriptSymbolInput,
): Promise<ResolvedTypeScriptSymbol> {
  if (!PACKAGE_NAME.test(input.packageName)) {
    throw new AdapterError('Package must be a registry-style npm package name, not a path or URL.');
  }
  if (!IDENTIFIER.test(input.symbol)) {
    throw new AdapterError('Symbol must be a TypeScript identifier.');
  }
  if (input.parameter !== undefined && !IDENTIFIER.test(input.parameter)) {
    throw new AdapterError('Parameter must be a TypeScript identifier.');
  }

  const packageJsonPath = await realpath(
    await findPackageJson(input.projectRoot, input.packageName),
  );
  const packageRoot = path.dirname(packageJsonPath);
  if (!isInside(input.repoRoot, packageRoot)) {
    throw new AdapterError('Resolved dependency is outside the repository; v0.1 refuses it.');
  }

  const packageJson = parsePackageJson(
    await readLimited(packageJsonPath, MAX_PACKAGE_JSON_BYTES),
    packageJsonPath,
  );
  if (packageJson.name !== input.packageName || typeof packageJson.version !== 'string') {
    throw new AdapterError('Resolved package name or version is invalid.');
  }

  const typeEntry = packageJson.types ?? packageJson.typings;
  if (typeof typeEntry !== 'string' || typeEntry.length === 0) {
    throw new AdapterError(`${input.packageName} does not declare a types or typings entry.`);
  }

  const declarationPath = await realpath(path.resolve(packageRoot, typeEntry));
  if (!isInside(packageRoot, declarationPath) || !isInside(input.repoRoot, declarationPath)) {
    throw new AdapterError('Declaration entry escapes the installed package or repository.');
  }
  const sourceText = await readLimited(declarationPath, MAX_DECLARATION_BYTES);

  const program = ts.createProgram({
    rootNames: [declarationPath],
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      types: [],
    },
  });
  const sourceFile = program.getSourceFile(declarationPath);
  if (!sourceFile) {
    throw new AdapterError('TypeScript could not load the dependency declaration file.');
  }

  const syntaxDiagnostics = program
    .getSyntacticDiagnostics(sourceFile)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntaxDiagnostics[0]) {
    throw new AdapterError(
      `Invalid TypeScript declaration: ${diagnosticText(syntaxDiagnostics[0])}`,
    );
  }

  // Touch the bounded source text so TypeScript cannot silently read a different path.
  if (sourceFile.text !== sourceText) {
    throw new AdapterError('Declaration file changed while it was being inspected.');
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new AdapterError('Declaration file has no external module exports.');
  }
  const exported = checker
    .getExportsOfModule(moduleSymbol)
    .find((item) => item.name === input.symbol);
  if (!exported) {
    throw new ContractMismatchError(
      `Exported symbol ${input.symbol} was not found.`,
      `<missing exported symbol ${input.symbol}>`,
    );
  }
  const target =
    exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const declaration = target.valueDeclaration ?? target.declarations?.[0];
  if (!declaration) {
    throw new AdapterError(`Symbol ${input.symbol} has no declaration.`);
  }
  const signatures = checker.getSignaturesOfType(
    checker.getTypeOfSymbolAtLocation(target, declaration),
    ts.SignatureKind.Call,
  );
  if (signatures.length !== 1 || !signatures[0]) {
    throw new ContractMismatchError(
      'v0.1 supports symbols with exactly one call signature.',
      `<${signatures.length} call signatures for ${input.symbol}>`,
    );
  }
  const signature = signatures[0];
  const parameterPresent =
    input.parameter === undefined ||
    signature.getParameters().some((parameter) => parameter.name === input.parameter);

  const rendered = checker.signatureToString(
    signature,
    declaration,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
    ts.SignatureKind.Call,
  );
  const normalized = normalizeSignature(`${input.symbol}${rendered}`);

  return {
    packageName: input.packageName,
    packageVersion: packageJson.version,
    resolvedPath: relativeToRepo(input.repoRoot, declarationPath),
    symbol: input.symbol,
    ...(input.parameter === undefined ? {} : { parameter: input.parameter }),
    ...(input.parameter === undefined ? {} : { parameterPresent }),
    signature: normalized,
    signatureHash: `sha256:${sha256(normalized)}`,
  };
}
