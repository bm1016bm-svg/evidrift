import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  AdapterError,
  ContractMismatchError,
  resolveTypeScriptSymbol,
} from './adapter/typescript-symbol.js';
import { JsonPointerMismatchError, resolveJsonPointer } from './adapter/json-pointer.js';
import { relativeToRepo, resolveInside } from './paths.js';
import { hasUnsafeControlCharacters } from './text.js';
import {
  IntegrityError,
  initializeRepository,
  readEvidenceLock,
  readReceipt,
  writeReceipt,
} from './storage.js';
import {
  RECEIPT_SCHEMA_VERSION,
  type CheckResult,
  type Receipt,
  type ReceiptPayload,
  type RecordInput,
} from './types.js';

export async function initEvidrift(repoRoot: string): Promise<boolean> {
  return initializeRepository(await realpath(repoRoot));
}

function validateText(value: string, label: string, maximum: number): void {
  if (value.trim().length === 0 || value.length > maximum || hasUnsafeControlCharacters(value)) {
    throw new Error(`${label} must contain 1-${maximum} safe text characters.`);
  }
}

export async function recordEvidence(input: RecordInput): Promise<Receipt> {
  validateText(input.claim, 'Claim', 500);
  const repoRoot = await realpath(input.repoRoot);
  const affectedCodePath = resolveInside(repoRoot, input.affectedCode.path, 'Affected code');
  let affectedCodeRealPath: string;
  try {
    affectedCodeRealPath = await realpath(affectedCodePath);
  } catch {
    throw new Error(`Affected code file was not found: ${input.affectedCode.path}.`);
  }
  if (resolveInside(repoRoot, affectedCodeRealPath, 'Affected code') !== affectedCodeRealPath) {
    throw new Error('Affected code path resolution is inconsistent.');
  }
  if (!(await stat(affectedCodeRealPath)).isFile()) {
    throw new Error(`Affected code path is not a regular file: ${input.affectedCode.path}.`);
  }
  if ('jsonPath' in input) {
    const source = await resolveJsonPointer({
      repoRoot,
      sourcePath: input.jsonPath,
      pointer: input.pointer,
    });
    return writeReceipt(repoRoot, {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      claim: input.claim.trim(),
      affectedCode: input.affectedCode,
      evidence: {
        adapter: 'json.pointer',
        sourcePath: source.sourcePath,
        pointer: source.pointer,
        expectedValue: source.value,
        valueHash: source.valueHash,
        sourceHash: source.sourceHash,
      },
    });
  }

  const projectRoot = await realpath(input.projectRoot);
  if (resolveInside(repoRoot, projectRoot, 'Project root') !== projectRoot) {
    throw new Error('Project root resolution is inconsistent.');
  }
  const source = await resolveTypeScriptSymbol({
    repoRoot,
    projectRoot,
    packageName: input.packageName,
    symbol: input.symbol,
    ...(input.parameter === undefined ? {} : { parameter: input.parameter }),
    ...(input.overload === undefined ? {} : { overload: input.overload }),
    ...(input.affectedCode.line === undefined
      ? {}
      : { callSite: { path: affectedCodeRealPath, line: input.affectedCode.line } }),
  });
  if (input.parameter !== undefined && source.parameterPresent !== true) {
    throw new AdapterError(`Parameter ${input.parameter} was not found on ${input.symbol}.`);
  }
  const payload: ReceiptPayload = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    claim: input.claim.trim(),
    affectedCode: input.affectedCode,
    evidence: {
      adapter: 'typescript.symbol',
      projectRoot: relativeToRepo(repoRoot, projectRoot),
      package: {
        name: source.packageName,
        version: source.packageVersion,
        resolvedPath: source.resolvedPath,
      },
      symbol: source.symbol,
      ...(source.parameter === undefined ? {} : { parameter: source.parameter }),
      expectedSignature: source.signature,
      signatureHash: source.signatureHash,
    },
  };
  return writeReceipt(repoRoot, payload);
}

async function checkReceipt(repoRoot: string, receipt: Receipt): Promise<CheckResult> {
  const evidence = receipt.evidence;
  if (evidence.adapter === 'json.pointer') {
    try {
      const current = await resolveJsonPointer({
        repoRoot,
        sourcePath: evidence.sourcePath,
        pointer: evidence.pointer,
        expectedValueHash: evidence.valueHash,
      });
      const common = {
        receiptId: receipt.id,
        claim: receipt.claim,
        expectedJsonValue: evidence.expectedValue,
        currentJsonValue: current.value,
        affectedCode: receipt.affectedCode,
        sourcePath: evidence.sourcePath,
        expectedSourceHash: evidence.sourceHash,
        currentSourceHash: current.sourceHash,
      };
      if (current.sourceHash !== evidence.sourceHash) {
        return {
          ...common,
          status: 'source_changed',
          blocking: false,
          message: 'JSON source changed, but the selected pointer value still matches.',
        };
      }
      return {
        ...common,
        status: 'pass',
        blocking: false,
        message: 'Deterministic JSON Pointer value matches.',
      };
    } catch (error) {
      if (error instanceof JsonPointerMismatchError) {
        return {
          receiptId: receipt.id,
          status: 'contract_mismatch',
          blocking: true,
          claim: receipt.claim,
          expectedJsonValue: evidence.expectedValue,
          currentJsonValue: error.currentValue,
          affectedCode: receipt.affectedCode,
          sourcePath: evidence.sourcePath,
          expectedSourceHash: evidence.sourceHash,
          message: `Deterministic JSON contract mismatch: ${error.message}`,
        };
      }
      return {
        receiptId: receipt.id,
        status: 'unverifiable',
        blocking: false,
        claim: receipt.claim,
        expectedJsonValue: evidence.expectedValue,
        affectedCode: receipt.affectedCode,
        sourcePath: evidence.sourcePath,
        expectedSourceHash: evidence.sourceHash,
        message: `JSON source could not be revalidated: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  try {
    const projectRoot = await realpath(
      resolveInside(repoRoot, evidence.projectRoot, 'Project root'),
    );
    const current = await resolveTypeScriptSymbol({
      repoRoot,
      projectRoot,
      packageName: evidence.package.name,
      symbol: evidence.symbol,
      ...(evidence.parameter === undefined ? {} : { parameter: evidence.parameter }),
      expectedSignatureHash: evidence.signatureHash,
    });

    const common = {
      receiptId: receipt.id,
      claim: receipt.claim,
      expectedSignature: evidence.expectedSignature,
      currentSignature: current.signature,
      affectedCode: receipt.affectedCode,
      expectedPackageVersion: evidence.package.version,
      currentPackageVersion: current.packageVersion,
      expectedResolvedPath: evidence.package.resolvedPath,
      currentResolvedPath: current.resolvedPath,
    };

    if (current.signatureHash !== evidence.signatureHash) {
      return {
        ...common,
        status: 'contract_mismatch',
        blocking: true,
        message: 'Deterministic TypeScript signature mismatch.',
      };
    }

    if (
      current.packageVersion !== evidence.package.version ||
      current.resolvedPath !== evidence.package.resolvedPath
    ) {
      return {
        ...common,
        status: 'source_changed',
        blocking: false,
        message: 'Source identity changed, but the deterministic signature still matches.',
      };
    }

    return {
      ...common,
      status: 'pass',
      blocking: false,
      message: 'Deterministic TypeScript signature matches.',
    };
  } catch (error) {
    if (error instanceof ContractMismatchError) {
      return {
        receiptId: receipt.id,
        status: 'contract_mismatch',
        blocking: true,
        claim: receipt.claim,
        expectedSignature: evidence.expectedSignature,
        currentSignature: error.currentSignature,
        affectedCode: receipt.affectedCode,
        expectedPackageVersion: evidence.package.version,
        expectedResolvedPath: evidence.package.resolvedPath,
        message: `Deterministic TypeScript contract mismatch: ${error.message}`,
      };
    }
    return {
      receiptId: receipt.id,
      status: 'unverifiable',
      blocking: false,
      claim: receipt.claim,
      expectedSignature: evidence.expectedSignature,
      affectedCode: receipt.affectedCode,
      expectedPackageVersion: evidence.package.version,
      expectedResolvedPath: evidence.package.resolvedPath,
      message: `Source could not be revalidated: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function checkRepository(repoRootInput: string): Promise<CheckResult[]> {
  const repoRoot = await realpath(repoRootInput);
  let lock;
  try {
    lock = await readEvidenceLock(repoRoot);
  } catch (error) {
    return [
      {
        receiptId: '(evidence.lock)',
        status: 'integrity_error',
        blocking: true,
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  const results: CheckResult[] = [];
  for (const receiptId of lock.receipts) {
    try {
      const receipt = await readReceipt(repoRoot, receiptId);
      results.push(await checkReceipt(repoRoot, receipt));
    } catch (error) {
      results.push({
        receiptId,
        status: 'integrity_error',
        blocking: true,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function explainEvidence(
  repoRootInput: string,
  receiptId: string,
): Promise<CheckResult> {
  const repoRoot = await realpath(repoRootInput);
  const lock = await readEvidenceLock(repoRoot);
  if (!lock.receipts.includes(receiptId)) {
    throw new IntegrityError(`Receipt ${receiptId} is not referenced by evidence.lock.`);
  }
  const receipt = await readReceipt(repoRoot, receiptId);
  return checkReceipt(repoRoot, receipt);
}

export function checkExitCode(results: readonly CheckResult[]): number {
  if (results.some((result) => result.status === 'integrity_error')) {
    return 2;
  }
  if (results.some((result) => result.status === 'contract_mismatch')) {
    return 1;
  }
  return 0;
}

export function affectedCodeLabel(pathValue: string, line?: number): string {
  return line === undefined ? pathValue : `${pathValue}:${line}`;
}

export function resolveCliProjectRoot(repoRoot: string, project: string): string {
  return resolveInside(path.resolve(repoRoot), project, 'Project root');
}
