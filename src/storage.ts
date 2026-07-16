import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalStringify, contentHash, sha256 } from './canonical.js';
import { validateJsonPointer } from './adapter/json-pointer.js';
import { assertSafeRelativePath, isInside, receiptFileName } from './paths.js';
import { hasUnsafeControlCharacters } from './text.js';
import {
  LOCK_SCHEMA_VERSION,
  RECEIPT_SCHEMA_VERSION,
  type AffectedCode,
  type Evidence,
  type EvidenceLock,
  type JsonPointerEvidence,
  type Receipt,
  type ReceiptPayload,
  type TypeScriptSymbolEvidence,
} from './types.js';

const EVIDRIFT_DIRECTORY = '.evidrift';
const LOCK_FILE = 'evidence.lock';
const RECEIPTS_DIRECTORY = 'receipts';
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAX_LOCK_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
export const MAX_RECEIPTS = 1024;
const MAX_PATH_CHARACTERS = 4096;
const MAX_SIGNATURE_CHARACTERS = 2 * 1024 * 1024;

export class IntegrityError extends Error {
  override name = 'IntegrityError';
}

function assertText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    hasUnsafeControlCharacters(value)
  ) {
    throw new IntegrityError(`${label} must contain 1-${maximum} safe text characters.`);
  }
  return value;
}

function assertCanonicalRelativePath(value: string, label: string, allowDot = true): string {
  const normalized = assertSafeRelativePath(value, label, allowDot);
  if (normalized !== value) {
    throw new IntegrityError(`${label} must use canonical forward-slash path syntax.`);
  }
  return value;
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IntegrityError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new IntegrityError(`${label} has unknown or missing fields.`);
  }
}

function parseAffectedCode(value: unknown): AffectedCode {
  const record = asRecord(value, 'affectedCode');
  const expectedKeys = record.line === undefined ? ['path'] : ['line', 'path'];
  assertExactKeys(record, expectedKeys, 'affectedCode');
  const safePath = assertCanonicalRelativePath(
    assertText(record.path, 'affectedCode.path', MAX_PATH_CHARACTERS),
    'affectedCode.path',
    false,
  );
  if (
    record.line !== undefined &&
    (!Number.isSafeInteger(record.line) || (record.line as number) < 1)
  ) {
    throw new IntegrityError('affectedCode.line must be a positive integer.');
  }
  return record.line === undefined
    ? { path: safePath }
    : { path: safePath, line: record.line as number };
}

function parseTypeScriptEvidence(record: Record<string, unknown>): TypeScriptSymbolEvidence {
  const expectedKeys = [
    'adapter',
    'expectedSignature',
    'package',
    'projectRoot',
    'signatureHash',
    'symbol',
    ...(record.parameter === undefined ? [] : ['parameter']),
  ];
  assertExactKeys(record, expectedKeys, 'evidence');
  if (record.adapter !== 'typescript.symbol') {
    throw new IntegrityError('Only the typescript.symbol adapter is valid in this release.');
  }
  if (typeof record.signatureHash !== 'string') {
    throw new IntegrityError('Evidence contains invalid field types.');
  }
  const projectRoot = assertText(record.projectRoot, 'evidence.projectRoot', MAX_PATH_CHARACTERS);
  const symbol = assertText(record.symbol, 'evidence.symbol', 256);
  const expectedSignature = assertText(
    record.expectedSignature,
    'evidence.expectedSignature',
    MAX_SIGNATURE_CHARACTERS,
  );
  const parameter =
    record.parameter === undefined
      ? undefined
      : assertText(record.parameter, 'evidence.parameter', 256);
  if (!IDENTIFIER.test(symbol) || (parameter !== undefined && !IDENTIFIER.test(parameter))) {
    throw new IntegrityError('Evidence symbol and parameter must be TypeScript identifiers.');
  }
  const packageRecord = asRecord(record.package, 'evidence.package');
  assertExactKeys(packageRecord, ['name', 'resolvedPath', 'version'], 'evidence.package');
  const packageName = assertText(packageRecord.name, 'evidence.package.name', 214);
  const packageVersion = assertText(packageRecord.version, 'evidence.package.version', 256);
  const resolvedPath = assertText(
    packageRecord.resolvedPath,
    'evidence.package.resolvedPath',
    MAX_PATH_CHARACTERS,
  );
  if (!PACKAGE_NAME.test(packageName)) {
    throw new IntegrityError('Evidence package name must be a registry-style npm package name.');
  }
  if (!SHA256_ID.test(record.signatureHash)) {
    throw new IntegrityError('Evidence signatureHash must be a full sha256 hash.');
  }
  const calculatedSignatureHash = `sha256:${sha256(expectedSignature)}`;
  if (calculatedSignatureHash !== record.signatureHash) {
    throw new IntegrityError('Expected signature does not match its signatureHash.');
  }

  return {
    adapter: 'typescript.symbol',
    projectRoot: assertCanonicalRelativePath(projectRoot, 'evidence.projectRoot'),
    package: {
      name: packageName,
      version: packageVersion,
      resolvedPath: assertCanonicalRelativePath(
        resolvedPath,
        'evidence.package.resolvedPath',
        false,
      ),
    },
    symbol,
    ...(parameter === undefined ? {} : { parameter }),
    expectedSignature,
    signatureHash: record.signatureHash,
  };
}

function parseJsonPointerEvidence(record: Record<string, unknown>): JsonPointerEvidence {
  assertExactKeys(
    record,
    ['adapter', 'expectedValue', 'pointer', 'sourceHash', 'sourcePath', 'valueHash'],
    'evidence',
  );
  const sourcePath = assertCanonicalRelativePath(
    assertText(record.sourcePath, 'evidence.sourcePath', MAX_PATH_CHARACTERS),
    'evidence.sourcePath',
    false,
  );
  if (path.extname(sourcePath).toLowerCase() !== '.json') {
    throw new IntegrityError('evidence.sourcePath must name a `.json` file.');
  }
  let pointer: string;
  try {
    pointer = validateJsonPointer(record.pointer);
  } catch (error) {
    throw new IntegrityError(error instanceof Error ? error.message : String(error));
  }
  const expectedValue = assertText(record.expectedValue, 'evidence.expectedValue', 1024 * 1024);
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(expectedValue) as unknown;
  } catch {
    throw new IntegrityError('evidence.expectedValue must be canonical JSON.');
  }
  if (canonicalStringify(parsedValue) !== expectedValue) {
    throw new IntegrityError('evidence.expectedValue must use canonical JSON serialization.');
  }
  if (
    typeof record.valueHash !== 'string' ||
    !SHA256_ID.test(record.valueHash) ||
    record.valueHash !== `sha256:${sha256(expectedValue)}`
  ) {
    throw new IntegrityError('evidence.valueHash does not match expectedValue.');
  }
  if (typeof record.sourceHash !== 'string' || !SHA256_ID.test(record.sourceHash)) {
    throw new IntegrityError('evidence.sourceHash must be a full sha256 hash.');
  }
  return {
    adapter: 'json.pointer',
    sourcePath,
    pointer,
    expectedValue,
    valueHash: record.valueHash,
    sourceHash: record.sourceHash,
  };
}

function parseEvidence(value: unknown): Evidence {
  const record = asRecord(value, 'evidence');
  if (record.adapter === 'typescript.symbol') {
    return parseTypeScriptEvidence(record);
  }
  if (record.adapter === 'json.pointer') {
    return parseJsonPointerEvidence(record);
  }
  throw new IntegrityError('Evidence adapter must be `typescript.symbol` or `json.pointer`.');
}

function parseReceiptPayload(value: unknown): ReceiptPayload {
  const record = asRecord(value, 'receipt payload');
  assertExactKeys(
    record,
    ['affectedCode', 'claim', 'evidence', 'schemaVersion'],
    'receipt payload',
  );
  if (record.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new IntegrityError('Unsupported receipt schemaVersion.');
  }
  const claim = assertText(record.claim, 'Receipt claim', 500);
  if (claim.trim() !== claim) {
    throw new IntegrityError('Receipt claim must not have leading or trailing whitespace.');
  }
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    claim,
    affectedCode: parseAffectedCode(record.affectedCode),
    evidence: parseEvidence(record.evidence),
  };
}

export function parseReceipt(value: unknown, expectedId?: string): Receipt {
  const record = asRecord(value, 'receipt');
  assertExactKeys(record, ['affectedCode', 'claim', 'evidence', 'id', 'schemaVersion'], 'receipt');
  if (typeof record.id !== 'string' || !SHA256_ID.test(record.id)) {
    throw new IntegrityError('Receipt ID must be a full sha256 content hash.');
  }
  if (expectedId !== undefined && record.id !== expectedId) {
    throw new IntegrityError('Receipt ID does not match evidence.lock.');
  }
  const payload = parseReceiptPayload({
    affectedCode: record.affectedCode,
    claim: record.claim,
    evidence: record.evidence,
    schemaVersion: record.schemaVersion,
  });
  if (contentHash(payload) !== record.id) {
    throw new IntegrityError('Receipt content hash mismatch.');
  }
  return { id: record.id, ...payload };
}

function parseLock(value: unknown): EvidenceLock {
  const record = asRecord(value, 'evidence.lock');
  assertExactKeys(record, ['receipts', 'schemaVersion'], 'evidence.lock');
  if (record.schemaVersion !== LOCK_SCHEMA_VERSION || !Array.isArray(record.receipts)) {
    throw new IntegrityError('Unsupported or invalid evidence.lock schema.');
  }
  if (record.receipts.length > MAX_RECEIPTS) {
    throw new IntegrityError(
      `evidence.lock contains more than ${MAX_RECEIPTS} Receipt IDs. Split or remove stale evidence before checking.`,
    );
  }
  const receipts = record.receipts.map((id) => {
    if (typeof id !== 'string' || !SHA256_ID.test(id)) {
      throw new IntegrityError('evidence.lock contains an invalid receipt ID.');
    }
    return id;
  });
  if (new Set(receipts).size !== receipts.length) {
    throw new IntegrityError('evidence.lock contains duplicate receipt IDs.');
  }
  return { schemaVersion: LOCK_SCHEMA_VERSION, receipts };
}

function paths(repoRoot: string): { evidrift: string; lock: string; receipts: string } {
  const evidrift = path.join(repoRoot, EVIDRIFT_DIRECTORY);
  return {
    evidrift,
    lock: path.join(evidrift, LOCK_FILE),
    receipts: path.join(evidrift, RECEIPTS_DIRECTORY),
  };
}

async function assertSafeDirectory(
  repoRoot: string,
  directory: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new IntegrityError(`${label} must be a real directory, not a symlink.`);
  }
  if (!isInside(path.resolve(repoRoot), await realpath(directory))) {
    throw new IntegrityError(`${label} resolves outside the repository.`);
  }
}

async function ensureSafeDirectory(
  repoRoot: string,
  directory: string,
  label: string,
  create: boolean,
): Promise<void> {
  try {
    await assertSafeDirectory(repoRoot, directory, label);
  } catch (error) {
    if (!create || !isMissing(error)) {
      throw error;
    }
    await mkdir(directory);
    await assertSafeDirectory(repoRoot, directory, label);
  }
}

async function storagePaths(
  repoRoot: string,
  create: boolean,
): Promise<{ evidrift: string; lock: string; receipts: string }> {
  const target = paths(repoRoot);
  await ensureSafeDirectory(repoRoot, target.evidrift, '.evidrift', create);
  await ensureSafeDirectory(repoRoot, target.receipts, '.evidrift/receipts', create);
  return target;
}

async function readUntrustedJson(
  repoRoot: string,
  filePath: string,
  label: string,
  maximumBytes: number,
): Promise<unknown> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new IntegrityError(`${label} must be a regular file, not a symlink.`);
  }
  const resolved = await realpath(filePath);
  if (!isInside(path.resolve(repoRoot), resolved)) {
    throw new IntegrityError(`${label} resolves outside the repository.`);
  }
  if (metadata.size > maximumBytes) {
    throw new IntegrityError(`${label} exceeds the ${maximumBytes}-byte limit.`);
  }
  try {
    return JSON.parse(await readFile(resolved, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new IntegrityError(`${label} is not valid JSON.`);
    }
    throw error;
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, filePath);
}

export async function initializeRepository(repoRoot: string): Promise<boolean> {
  const target = await storagePaths(repoRoot, true);
  try {
    parseLock(await readUntrustedJson(repoRoot, target.lock, 'evidence.lock', MAX_LOCK_BYTES));
    return false;
  } catch (error) {
    if (error instanceof IntegrityError) {
      throw error;
    }
    if (!isMissing(error)) {
      throw new IntegrityError('Existing evidence.lock could not be safely read.');
    }
    const initial: EvidenceLock = { schemaVersion: LOCK_SCHEMA_VERSION, receipts: [] };
    await atomicWrite(target.lock, `${canonicalStringify(initial)}\n`);
    return true;
  }
}

export async function readEvidenceLock(repoRoot: string): Promise<EvidenceLock> {
  try {
    const target = await storagePaths(repoRoot, false);
    return parseLock(
      await readUntrustedJson(repoRoot, target.lock, 'evidence.lock', MAX_LOCK_BYTES),
    );
  } catch (error) {
    if (error instanceof IntegrityError) {
      throw error;
    }
    throw new IntegrityError('Missing or unreadable .evidrift/evidence.lock; run `evidrift init`.');
  }
}

export async function readReceipt(repoRoot: string, receiptId: string): Promise<Receipt> {
  const fileName = receiptFileName(receiptId);
  try {
    const target = await storagePaths(repoRoot, false);
    const filePath = path.join(target.receipts, fileName);
    return parseReceipt(
      await readUntrustedJson(repoRoot, filePath, `Receipt ${receiptId}`, MAX_RECEIPT_BYTES),
      receiptId,
    );
  } catch (error) {
    if (error instanceof IntegrityError) {
      throw error;
    }
    throw new IntegrityError(`Receipt file is missing or unreadable for ${receiptId}.`);
  }
}

export async function writeReceipt(repoRoot: string, payload: ReceiptPayload): Promise<Receipt> {
  const target = await storagePaths(repoRoot, false);
  const validatedPayload = parseReceiptPayload(payload);
  const id = contentHash(validatedPayload);
  const receipt: Receipt = { id, ...validatedPayload };
  const receiptPath = path.join(target.receipts, receiptFileName(id));
  const lock = await readEvidenceLock(repoRoot);
  if (!lock.receipts.includes(id) && lock.receipts.length >= MAX_RECEIPTS) {
    throw new IntegrityError(
      `evidence.lock already contains the maximum of ${MAX_RECEIPTS} Receipt IDs. Remove stale evidence before recording another Receipt.`,
    );
  }

  try {
    const existing = parseReceipt(
      await readUntrustedJson(repoRoot, receiptPath, `Receipt ${id}`, MAX_RECEIPT_BYTES),
      id,
    );
    if (canonicalStringify(existing) !== canonicalStringify(receipt)) {
      throw new IntegrityError(`Existing receipt file for ${id} is inconsistent.`);
    }
  } catch (error) {
    if (error instanceof IntegrityError) {
      throw error;
    }
    if (!isMissing(error)) {
      throw new IntegrityError(`Existing receipt ${id} could not be safely read.`);
    }
    await atomicWrite(receiptPath, `${canonicalStringify(receipt)}\n`);
  }

  if (!lock.receipts.includes(id)) {
    const next: EvidenceLock = {
      schemaVersion: LOCK_SCHEMA_VERSION,
      receipts: [...lock.receipts, id].sort(),
    };
    parseLock(next);
    await atomicWrite(target.lock, `${canonicalStringify(next)}\n`);
  }
  return receipt;
}
