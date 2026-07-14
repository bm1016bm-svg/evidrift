import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
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
const MAX_DECLARATION_FILES = 256;
const MAX_TOTAL_DECLARATION_BYTES = 16 * 1024 * 1024;
const SIGNATURE_PUNCTUATION = new Set([',', ':', '?', '(', ')', '<', '>', '|', '&']);

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
  let normalized = '';
  let pendingSpace = false;
  let quote: "'" | '"' | '`' | undefined;
  let escaped = false;

  for (const character of value) {
    if (quote !== undefined) {
      normalized += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      const previous = normalized.at(-1);
      if (pendingSpace && normalized.length > 0 && !SIGNATURE_PUNCTUATION.has(previous ?? '')) {
        normalized += ' ';
      }
      pendingSpace = false;
      quote = character;
      normalized += character;
      continue;
    }

    if (/\s/u.test(character)) {
      pendingSpace = true;
      continue;
    }

    if (SIGNATURE_PUNCTUATION.has(character)) {
      normalized = normalized.replace(/ $/u, '');
      normalized += character;
      pendingSpace = false;
      continue;
    }

    const previous = normalized.at(-1);
    if (pendingSpace && normalized.length > 0 && !SIGNATURE_PUNCTUATION.has(previous ?? '')) {
      normalized += ' ';
    }
    pendingSpace = false;
    normalized += character;
  }

  return normalized.trim();
}

function diagnosticText(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
}

interface AllowedCompilerFile {
  path: string;
  trustedCompilerFile: boolean;
}

function createBoundedCompilerHost(
  repoRootInput: string,
  options: ts.CompilerOptions,
  rootFile: string,
  rootText: string,
): {
  host: ts.CompilerHost;
  auditTransitiveSources: () => void;
  assertNoEscapedRead: () => void;
} {
  const repoRoot = realpathSync(repoRootInput);
  const compilerLibraryRoot = realpathSync(path.dirname(ts.getDefaultLibFilePath(options)));
  const baseHost = ts.createCompilerHost(options, true);
  const sourceCache = new Map<string, string>([[rootFile, rootText]]);
  const untrustedSourceBytes = new Map<string, number>([
    [rootFile, Buffer.byteLength(rootText, 'utf8')],
  ]);
  let totalUntrustedBytes = untrustedSourceBytes.get(rootFile) ?? 0;
  let escapedReadObserved = false;

  function allowedFile(fileName: string, recordEscape: boolean): AllowedCompilerFile | undefined {
    if (!existsSync(fileName)) {
      return undefined;
    }
    let resolved: string;
    try {
      resolved = realpathSync(fileName);
    } catch {
      return undefined;
    }
    const metadata = lstatSync(resolved);
    if (!metadata.isFile()) {
      return undefined;
    }
    if (isInside(repoRoot, resolved)) {
      return { path: resolved, trustedCompilerFile: false };
    }
    if (isInside(compilerLibraryRoot, resolved)) {
      return { path: resolved, trustedCompilerFile: true };
    }
    if (recordEscape) {
      escapedReadObserved = true;
    }
    return undefined;
  }

  function allowedDirectory(directoryName: string): string | undefined {
    if (!existsSync(directoryName)) {
      return undefined;
    }
    let resolved: string;
    try {
      resolved = realpathSync(directoryName);
    } catch {
      return undefined;
    }
    if (!lstatSync(resolved).isDirectory()) {
      return undefined;
    }
    return isInside(repoRoot, resolved) || isInside(compilerLibraryRoot, resolved)
      ? resolved
      : undefined;
  }

  function readBoundedSource(fileName: string): { path: string; text: string } | undefined {
    const allowed = allowedFile(fileName, true);
    if (allowed === undefined) {
      return undefined;
    }
    const cached = sourceCache.get(allowed.path);
    if (cached !== undefined) {
      return { path: allowed.path, text: cached };
    }

    const metadata = lstatSync(allowed.path);
    if (metadata.size > MAX_DECLARATION_BYTES) {
      throw new AdapterError(
        `A TypeScript source exceeds the ${MAX_DECLARATION_BYTES}-byte per-file limit.`,
      );
    }
    if (!allowed.trustedCompilerFile) {
      if (untrustedSourceBytes.size >= MAX_DECLARATION_FILES) {
        throw new AdapterError(
          `TypeScript evidence loads more than ${MAX_DECLARATION_FILES} repository source files.`,
        );
      }
      if (totalUntrustedBytes + metadata.size > MAX_TOTAL_DECLARATION_BYTES) {
        throw new AdapterError(
          `TypeScript evidence exceeds the ${MAX_TOTAL_DECLARATION_BYTES}-byte aggregate source limit.`,
        );
      }
    }

    const text = readFileSync(allowed.path, 'utf8');
    const actualBytes = Buffer.byteLength(text, 'utf8');
    if (actualBytes > MAX_DECLARATION_BYTES) {
      throw new AdapterError(
        `A TypeScript source exceeds the ${MAX_DECLARATION_BYTES}-byte per-file limit.`,
      );
    }
    if (!allowed.trustedCompilerFile) {
      if (totalUntrustedBytes + actualBytes > MAX_TOTAL_DECLARATION_BYTES) {
        throw new AdapterError(
          `TypeScript evidence exceeds the ${MAX_TOTAL_DECLARATION_BYTES}-byte aggregate source limit.`,
        );
      }
      untrustedSourceBytes.set(allowed.path, actualBytes);
      totalUntrustedBytes += actualBytes;
    }
    sourceCache.set(allowed.path, text);
    return { path: allowed.path, text };
  }

  const host: ts.CompilerHost = {
    ...baseHost,
    getCurrentDirectory: () => repoRoot,
    fileExists: (fileName) => allowedFile(fileName, true) !== undefined,
    readFile: (fileName) => readBoundedSource(fileName)?.text,
    getSourceFile: (fileName, languageVersion, onError) => {
      try {
        const source = readBoundedSource(fileName);
        return source === undefined
          ? undefined
          : ts.createSourceFile(source.path, source.text, languageVersion, true);
      } catch (error) {
        if (error instanceof AdapterError) {
          throw error;
        }
        onError?.(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
    realpath: (fileName) => allowedFile(fileName, true)?.path ?? fileName,
    directoryExists: (directoryName) => allowedDirectory(directoryName) !== undefined,
    getDirectories: (directoryName) => {
      const resolved = allowedDirectory(directoryName);
      return resolved === undefined ? [] : (baseHost.getDirectories?.(resolved) ?? []);
    },
  };

  function auditTransitiveSources(): void {
    const pending = [rootFile];
    const visited = new Set<string>();

    const enqueue = (fileName: string, description: string): void => {
      const allowed = allowedFile(fileName, true);
      if (allowed === undefined) {
        if (escapedReadObserved) {
          throw new AdapterError(
            'A transitive TypeScript source resolves outside the repository; v0.1 refuses it.',
          );
        }
        throw new AdapterError(`${description} could not be resolved to a readable source file.`);
      }
      if (!allowed.trustedCompilerFile && !visited.has(allowed.path)) {
        pending.push(allowed.path);
      }
    };

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) {
        break;
      }
      const source = readBoundedSource(current);
      if (source === undefined || visited.has(source.path)) {
        continue;
      }
      visited.add(source.path);
      const references = ts.preProcessFile(source.text, true, true);

      for (const imported of references.importedFiles) {
        if (
          (imported.fileName.startsWith('./') ||
            imported.fileName.startsWith('../') ||
            path.isAbsolute(imported.fileName)) &&
          !isInside(repoRoot, path.resolve(path.dirname(source.path), imported.fileName))
        ) {
          throw new AdapterError(
            'A transitive TypeScript source resolves outside the repository; v0.1 refuses it.',
          );
        }
        const resolution = ts.resolveModuleName(imported.fileName, source.path, options, host);
        if (resolution.resolvedModule === undefined) {
          if (escapedReadObserved) {
            throw new AdapterError(
              'A transitive TypeScript source resolves outside the repository; v0.1 refuses it.',
            );
          }
          throw new AdapterError(
            `TypeScript import ${imported.fileName} from ${relativeToRepo(repoRoot, source.path)} could not be resolved.`,
          );
        }
        enqueue(
          resolution.resolvedModule.resolvedFileName,
          `TypeScript import ${imported.fileName}`,
        );
      }

      for (const referenced of references.referencedFiles) {
        enqueue(
          path.resolve(path.dirname(source.path), referenced.fileName),
          `TypeScript reference ${referenced.fileName}`,
        );
      }

      for (const typeReference of references.typeReferenceDirectives) {
        const resolution = ts.resolveTypeReferenceDirective(
          typeReference.fileName,
          source.path,
          options,
          host,
        );
        if (resolution.resolvedTypeReferenceDirective?.resolvedFileName === undefined) {
          if (escapedReadObserved) {
            throw new AdapterError(
              'A transitive TypeScript source resolves outside the repository; v0.1 refuses it.',
            );
          }
          throw new AdapterError(
            `TypeScript type reference ${typeReference.fileName} from ${relativeToRepo(repoRoot, source.path)} could not be resolved.`,
          );
        }
        enqueue(
          resolution.resolvedTypeReferenceDirective.resolvedFileName,
          `TypeScript type reference ${typeReference.fileName}`,
        );
      }
    }
  }

  return {
    host,
    auditTransitiveSources,
    assertNoEscapedRead: () => {
      if (escapedReadObserved) {
        throw new AdapterError(
          'A transitive TypeScript source resolves outside the repository; v0.1 refuses it.',
        );
      }
    },
  };
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

  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    types: [],
  };
  const boundedHost = createBoundedCompilerHost(
    input.repoRoot,
    compilerOptions,
    declarationPath,
    sourceText,
  );
  boundedHost.auditTransitiveSources();
  const program = ts.createProgram({
    rootNames: [declarationPath],
    options: compilerOptions,
    host: boundedHost.host,
  });
  const sourceFile = program.getSourceFile(declarationPath);
  if (!sourceFile) {
    throw new AdapterError('TypeScript could not load the dependency declaration file.');
  }

  const syntaxDiagnostics = program
    .getSyntacticDiagnostics()
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
  // TypeScript may defer module resolution until the checker renders a type.
  // Inspect the escape flag only after all evidence-producing checker work.
  boundedHost.assertNoEscapedRead();

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
