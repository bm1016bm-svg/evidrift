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
const MAX_TSCONFIG_BYTES = 1024 * 1024;
const MAX_DECLARATION_BYTES = 2 * 1024 * 1024;
const MAX_DECLARATION_FILES = 256;
const MAX_TOTAL_DECLARATION_BYTES = 16 * 1024 * 1024;
const MAX_CALL_SIGNATURES = 64;
const MAX_SIGNATURE_PREVIEW_CHARACTERS = 512;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
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
  roots: readonly { path: string; text: string }[],
): {
  host: ts.CompilerHost;
  auditTransitiveSources: () => void;
  assertNoEscapedRead: () => void;
} {
  const repoRoot = realpathSync(repoRootInput);
  const compilerLibraryRoot = realpathSync(path.dirname(ts.getDefaultLibFilePath(options)));
  const baseHost = ts.createCompilerHost(options, true);
  const sourceCache = new Map(roots.map((root) => [root.path, root.text]));
  const untrustedSourceBytes = new Map(
    roots.map((root) => [root.path, Buffer.byteLength(root.text, 'utf8')]),
  );
  let totalUntrustedBytes = [...untrustedSourceBytes.values()].reduce(
    (total, bytes) => total + bytes,
    0,
  );
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
    const pending = roots.map((root) => root.path);
    const visited = new Set<string>();

    const enqueue = (fileName: string, description: string): void => {
      const allowed = allowedFile(fileName, true);
      if (allowed === undefined) {
        if (escapedReadObserved) {
          throw new AdapterError(
            'A transitive TypeScript source resolves outside the repository; Evidrift refuses it.',
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
            'A transitive TypeScript source resolves outside the repository; Evidrift refuses it.',
          );
        }
        const resolution = ts.resolveModuleName(imported.fileName, source.path, options, host);
        if (resolution.resolvedModule === undefined) {
          if (escapedReadObserved) {
            throw new AdapterError(
              'A transitive TypeScript source resolves outside the repository; Evidrift refuses it.',
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
              'A transitive TypeScript source resolves outside the repository; Evidrift refuses it.',
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
          'A transitive TypeScript source resolves outside the repository; Evidrift refuses it.',
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
  overload?: number;
  callSite?: { path: string; line: number };
  expectedSignatureHash?: string;
}

interface RenderedCallSignature {
  signature: string;
  signatureHash: string;
  parameterPresent: boolean;
}

function renderCallSignature(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  declaration: ts.Declaration,
  symbol: string,
  parameter?: string,
): RenderedCallSignature {
  const value = normalizeSignature(
    `${symbol}${checker.signatureToString(
      signature,
      declaration,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      ts.SignatureKind.Call,
    )}`,
  );
  return {
    signature: value,
    signatureHash: `sha256:${sha256(value)}`,
    parameterPresent:
      parameter === undefined ||
      signature.getParameters().some((candidate) => candidate.name === parameter),
  };
}

function signaturePreview(value: string): string {
  return value.length <= MAX_SIGNATURE_PREVIEW_CHARACTERS
    ? value
    : `${value.slice(0, MAX_SIGNATURE_PREVIEW_CHARACTERS)}…`;
}

function renderOverloadSet(signatures: readonly RenderedCallSignature[]): string {
  return `<overloads: ${signatures
    .map(
      (signature, index) =>
        `[${index + 1}] ${signature.signatureHash} ${signaturePreview(signature.signature)}`,
    )
    .join(' | ')}>`;
}

function overloadSelectionMessage(
  symbol: string,
  signatures: readonly RenderedCallSignature[],
): string {
  return `Symbol ${symbol} has ${signatures.length} overloads. Rerun with --overload <1-${signatures.length}>. Candidates: ${renderOverloadSet(signatures)}`;
}

function defaultCompilerOptions(): ts.CompilerOptions {
  return {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    types: [],
  };
}

function callSiteCompilerOptions(repoRoot: string, projectRoot: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(projectRoot, (candidate) => {
    try {
      const resolved = realpathSync(candidate);
      return isInside(repoRoot, resolved) && lstatSync(resolved).isFile();
    } catch {
      return false;
    }
  });
  if (configPath === undefined) {
    return defaultCompilerOptions();
  }

  const readConfig = (candidate: string): string | undefined => {
    try {
      const resolved = realpathSync(candidate);
      const metadata = lstatSync(resolved);
      if (
        !isInside(repoRoot, resolved) ||
        !metadata.isFile() ||
        metadata.size > MAX_TSCONFIG_BYTES
      ) {
        return undefined;
      }
      return readFileSync(resolved, 'utf8');
    } catch {
      return undefined;
    }
  };
  const config = ts.readConfigFile(configPath, readConfig);
  if (config.error !== undefined) {
    throw new AdapterError(`Invalid tsconfig: ${diagnosticText(config.error)}.`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      fileExists: (candidate) => readConfig(candidate) !== undefined,
      readFile: readConfig,
      readDirectory: () => [],
    },
    path.dirname(configPath),
    { noEmit: true },
    configPath,
  );
  const error = parsed.errors.find(
    (diagnostic) =>
      diagnostic.category === ts.DiagnosticCategory.Error && diagnostic.code !== 18003,
  );
  if (error !== undefined) {
    throw new AdapterError(`Invalid tsconfig: ${diagnosticText(error)}.`);
  }
  return { ...parsed.options, noEmit: true, skipLibCheck: true };
}

function callTargetSymbol(checker: ts.TypeChecker, call: ts.CallExpression): ts.Symbol | undefined {
  const expression = call.expression;
  const location = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  const symbol = checker.getSymbolAtLocation(location);
  return symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function sameDeclaration(left: ts.Signature, right: ts.Signature): boolean {
  const leftDeclaration = left.getDeclaration();
  const rightDeclaration = right.getDeclaration();
  return (
    leftDeclaration === rightDeclaration ||
    (leftDeclaration.pos === rightDeclaration.pos &&
      leftDeclaration.end === rightDeclaration.end &&
      leftDeclaration.getSourceFile().fileName === rightDeclaration.getSourceFile().fileName)
  );
}

async function selectCallSiteSignature(input: {
  repoRoot: string;
  projectRoot: string;
  declarationPath: string;
  declarationText: string;
  symbol: string;
  parameter?: string;
  callSite: { path: string; line: number };
}): Promise<RenderedCallSignature> {
  const callSiteText = await readLimited(input.callSite.path, MAX_DECLARATION_BYTES);
  const compilerOptions = callSiteCompilerOptions(input.repoRoot, input.projectRoot);
  const roots = [
    { path: input.declarationPath, text: input.declarationText },
    { path: input.callSite.path, text: callSiteText },
  ];
  const boundedHost = createBoundedCompilerHost(input.repoRoot, compilerOptions, roots);
  boundedHost.auditTransitiveSources();
  const program = ts.createProgram({
    rootNames: roots.map((root) => root.path),
    options: compilerOptions,
    host: boundedHost.host,
  });
  const declarationFile = program.getSourceFile(input.declarationPath);
  const callSiteFile = program.getSourceFile(input.callSite.path);
  if (declarationFile === undefined || callSiteFile === undefined) {
    throw new AdapterError('TypeScript could not load the declaration and affected code together.');
  }
  const syntaxError = program
    .getSyntacticDiagnostics(callSiteFile)
    .find((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntaxError !== undefined) {
    throw new AdapterError(`Affected code has invalid TypeScript: ${diagnosticText(syntaxError)}.`);
  }

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(declarationFile);
  const exported =
    moduleSymbol === undefined
      ? undefined
      : checker.getExportsOfModule(moduleSymbol).find((item) => item.name === input.symbol);
  if (exported === undefined) {
    throw new AdapterError(
      `Exported symbol ${input.symbol} was not found while resolving the call site.`,
    );
  }
  const target =
    exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const declaration = target.valueDeclaration ?? target.declarations?.[0];
  if (declaration === undefined) {
    throw new AdapterError(`Symbol ${input.symbol} has no declaration.`);
  }
  const signatures = checker.getSignaturesOfType(
    checker.getTypeOfSymbolAtLocation(target, declaration),
    ts.SignatureKind.Call,
  );

  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const startLine = callSiteFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const endLine = callSiteFile.getLineAndCharacterOfPosition(node.end).line + 1;
      const called = callTargetSymbol(checker, node);
      if (input.callSite.line >= startLine && input.callSite.line <= endLine && called === target) {
        calls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(callSiteFile);
  if (calls.length === 0) {
    throw new AdapterError(
      `No call to ${input.symbol} was found at ${relativeToRepo(input.repoRoot, input.callSite.path)}:${input.callSite.line}. Point --code at the call or use --overload.`,
    );
  }

  const relevantError = program.getSemanticDiagnostics(callSiteFile).find((diagnostic) => {
    if (
      diagnostic.category !== ts.DiagnosticCategory.Error ||
      diagnostic.start === undefined ||
      diagnostic.length === undefined
    ) {
      return false;
    }
    const end = diagnostic.start + diagnostic.length;
    return calls.some((call) => diagnostic.start! <= call.end && end >= call.getStart());
  });
  if (relevantError !== undefined) {
    throw new AdapterError(
      `TypeScript cannot resolve the affected call: ${diagnosticText(relevantError)}.`,
    );
  }

  const selected = calls.map((call) => {
    const resolved = checker.getResolvedSignature(call);
    return resolved === undefined
      ? undefined
      : signatures.find((candidate) => sameDeclaration(candidate, resolved));
  });
  if (selected.some((signature) => signature === undefined)) {
    throw new AdapterError(
      `TypeScript did not resolve ${input.symbol} to a declared overload at the affected call. Use --overload explicitly.`,
    );
  }
  const rendered = selected.map((signature) =>
    renderCallSignature(
      checker,
      signature as ts.Signature,
      declaration,
      input.symbol,
      input.parameter,
    ),
  );
  const unique = new Map(rendered.map((signature) => [signature.signatureHash, signature]));
  if (unique.size !== 1) {
    throw new AdapterError(
      `Multiple calls to ${input.symbol} at the affected line resolve to different overloads. Put each call on its own line or use --overload.`,
    );
  }
  boundedHost.assertNoEscapedRead();
  return [...unique.values()][0] as RenderedCallSignature;
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
  if (
    input.overload !== undefined &&
    (!Number.isSafeInteger(input.overload) || input.overload < 1)
  ) {
    throw new AdapterError('Overload selector must be a positive safe integer.');
  }
  if (input.expectedSignatureHash !== undefined && !SHA256_ID.test(input.expectedSignatureHash)) {
    throw new AdapterError('Expected signature hash must be a full sha256 hash.');
  }
  if (input.overload !== undefined && input.expectedSignatureHash !== undefined) {
    throw new AdapterError('Overload index and expected signature hash cannot be combined.');
  }

  const packageJsonPath = await realpath(
    await findPackageJson(input.projectRoot, input.packageName),
  );
  const packageRoot = path.dirname(packageJsonPath);
  if (!isInside(input.repoRoot, packageRoot)) {
    throw new AdapterError('Resolved dependency is outside the repository; Evidrift refuses it.');
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

  const compilerOptions = defaultCompilerOptions();
  const boundedHost = createBoundedCompilerHost(input.repoRoot, compilerOptions, [
    { path: declarationPath, text: sourceText },
  ]);
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
  if (signatures.length === 0) {
    throw new ContractMismatchError(
      `Exported symbol ${input.symbol} has no callable signatures.`,
      `<0 call signatures for ${input.symbol}>`,
    );
  }
  if (signatures.length > MAX_CALL_SIGNATURES) {
    throw new AdapterError(
      `Symbol ${input.symbol} exposes more than ${MAX_CALL_SIGNATURES} call signatures.`,
    );
  }

  const renderedSignatures = signatures.map((signature) =>
    renderCallSignature(checker, signature, declaration, input.symbol, input.parameter),
  );
  // TypeScript may defer module resolution until the checker renders a type.
  // Inspect the escape flag only after all evidence-producing checker work.
  boundedHost.assertNoEscapedRead();

  let selected: RenderedCallSignature | undefined;
  if (input.expectedSignatureHash !== undefined) {
    selected = renderedSignatures.find(
      (signature) => signature.signatureHash === input.expectedSignatureHash,
    );
    if (selected === undefined) {
      throw new ContractMismatchError(
        signatures.length === 1
          ? 'Previously recorded TypeScript signature was not found.'
          : 'Previously selected TypeScript overload was not found in the current overload set.',
        signatures.length === 1
          ? (renderedSignatures[0]?.signature ?? `<0 call signatures for ${input.symbol}>`)
          : renderOverloadSet(renderedSignatures),
      );
    }
  } else if (signatures.length > 1) {
    if (input.overload === undefined) {
      if (input.callSite === undefined) {
        throw new AdapterError(overloadSelectionMessage(input.symbol, renderedSignatures));
      }
      selected = await selectCallSiteSignature({
        repoRoot: input.repoRoot,
        projectRoot: input.projectRoot,
        declarationPath,
        declarationText: sourceText,
        symbol: input.symbol,
        ...(input.parameter === undefined ? {} : { parameter: input.parameter }),
        callSite: input.callSite,
      });
    } else {
      selected = renderedSignatures[input.overload - 1];
      if (selected === undefined) {
        throw new AdapterError(
          `Overload selector ${input.overload} is out of range for ${input.symbol}; expected 1-${signatures.length}.`,
        );
      }
    }
  } else {
    if (input.overload !== undefined && input.overload !== 1) {
      throw new AdapterError(
        `Overload selector ${input.overload} is out of range for ${input.symbol}; expected 1.`,
      );
    }
    selected = renderedSignatures[0];
  }

  if (selected === undefined) {
    throw new AdapterError(`TypeScript could not select a call signature for ${input.symbol}.`);
  }

  return {
    packageName: input.packageName,
    packageVersion: packageJson.version,
    resolvedPath: relativeToRepo(input.repoRoot, declarationPath),
    symbol: input.symbol,
    ...(input.parameter === undefined ? {} : { parameter: input.parameter }),
    ...(input.parameter === undefined ? {} : { parameterPresent: selected.parameterPresent }),
    signature: selected.signature,
    signatureHash: selected.signatureHash,
  };
}
