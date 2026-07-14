import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalStringify, contentHash, sha256 } from './canonical.js';
import { assertSafeRelativePath, receiptFileName } from './paths.js';
import {
  LOCK_SCHEMA_VERSION,
  RECEIPT_SCHEMA_VERSION,
  type AffectedCode,
  type EvidenceLock,
  type Receipt,
  type ReceiptPayload,
  type TypeScriptSymbolEvidence,
} from './types.js';

const LITMO_DIRECTORY = '.litmo';
const LOCK_FILE = 'evidence.lock';
const RECEIPTS_DIRECTORY = 'receipts';
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;

export class IntegrityError extends Error {
  override name = 'IntegrityError';
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
  if (typeof record.path !== 'string') {
    throw new IntegrityError('affectedCode.path must be a string.');
  }
  const safePath = assertSafeRelativePath(record.path, 'affectedCode.path', false);
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

function parseEvidence(value: unknown): TypeScriptSymbolEvidence {
  const record = asRecord(value, 'evidence');
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
    throw new IntegrityError('Only the typescript.symbol adapter is valid in v0.1.');
  }
  if (
    typeof record.projectRoot !== 'string' ||
    typeof record.symbol !== 'string' ||
    typeof record.expectedSignature !== 'string' ||
    typeof record.signatureHash !== 'string' ||
    (record.parameter !== undefined && typeof record.parameter !== 'string')
  ) {
    throw new IntegrityError('Evidence contains invalid field types.');
  }
  const packageRecord = asRecord(record.package, 'evidence.package');
  assertExactKeys(packageRecord, ['name', 'resolvedPath', 'version'], 'evidence.package');
  if (
    typeof packageRecord.name !== 'string' ||
    typeof packageRecord.version !== 'string' ||
    typeof packageRecord.resolvedPath !== 'string'
  ) {
    throw new IntegrityError('Evidence package fields must be strings.');
  }
  if (!SHA256_ID.test(record.signatureHash)) {
    throw new IntegrityError('Evidence signatureHash must be a full sha256 hash.');
  }
  const calculatedSignatureHash = `sha256:${sha256(record.expectedSignature)}`;
  if (calculatedSignatureHash !== record.signatureHash) {
    throw new IntegrityError('Expected signature does not match its signatureHash.');
  }

  return {
    adapter: 'typescript.symbol',
    projectRoot: assertSafeRelativePath(record.projectRoot, 'evidence.projectRoot'),
    package: {
      name: packageRecord.name,
      version: packageRecord.version,
      resolvedPath: assertSafeRelativePath(
        packageRecord.resolvedPath,
        'evidence.package.resolvedPath',
        false,
      ),
    },
    symbol: record.symbol,
    ...(record.parameter === undefined ? {} : { parameter: record.parameter }),
    expectedSignature: record.expectedSignature,
    signatureHash: record.signatureHash,
  };
}

export function parseReceipt(value: unknown, expectedId?: string): Receipt {
  const record = asRecord(value, 'receipt');
  assertExactKeys(record, ['affectedCode', 'claim', 'evidence', 'id', 'schemaVersion'], 'receipt');
  if (record.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new IntegrityError('Unsupported receipt schemaVersion.');
  }
  if (typeof record.id !== 'string' || !SHA256_ID.test(record.id)) {
    throw new IntegrityError('Receipt ID must be a full sha256 content hash.');
  }
  if (expectedId !== undefined && record.id !== expectedId) {
    throw new IntegrityError('Receipt ID does not match evidence.lock.');
  }
  if (typeof record.claim !== 'string' || record.claim.length === 0) {
    throw new IntegrityError('Receipt claim must be a non-empty string.');
  }
  const payload: ReceiptPayload = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    claim: record.claim,
    affectedCode: parseAffectedCode(record.affectedCode),
    evidence: parseEvidence(record.evidence),
  };
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

function paths(repoRoot: string): { litmo: string; lock: string; receipts: string } {
  const litmo = path.join(repoRoot, LITMO_DIRECTORY);
  return {
    litmo,
    lock: path.join(litmo, LOCK_FILE),
    receipts: path.join(litmo, RECEIPTS_DIRECTORY),
  };
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporary, filePath);
}

export async function initializeRepository(repoRoot: string): Promise<boolean> {
  const target = paths(repoRoot);
  await mkdir(target.receipts, { recursive: true });
  try {
    await stat(target.lock);
    parseLock(JSON.parse(await readFile(target.lock, 'utf8')) as unknown);
    return false;
  } catch (error) {
    if (error instanceof IntegrityError) {
      throw error;
    }
    const initial: EvidenceLock = { schemaVersion: LOCK_SCHEMA_VERSION, receipts: [] };
    await atomicWrite(target.lock, `${canonicalStringify(initial)}\n`);
    return true;
  }
}

export async function readEvidenceLock(repoRoot: string): Promise<EvidenceLock> {
  const lockPath = paths(repoRoot).lock;
  try {
    return parseLock(JSON.parse(await readFile(lockPath, 'utf8')) as unknown);
  } catch (error) {
    if (error instanceof IntegrityError || error instanceof SyntaxError) {
      throw new IntegrityError(
        error instanceof SyntaxError ? 'evidence.lock is not valid JSON.' : error.message,
      );
    }
    throw new IntegrityError('Missing .litmo/evidence.lock; run `litmo init`.');
  }
}

export async function readReceipt(repoRoot: string, receiptId: string): Promise<Receipt> {
  const fileName = receiptFileName(receiptId);
  const filePath = path.join(paths(repoRoot).receipts, fileName);
  try {
    return parseReceipt(JSON.parse(await readFile(filePath, 'utf8')) as unknown, receiptId);
  } catch (error) {
    if (error instanceof IntegrityError || error instanceof SyntaxError) {
      throw new IntegrityError(
        error instanceof SyntaxError ? `Receipt ${receiptId} is not valid JSON.` : error.message,
      );
    }
    throw new IntegrityError(`Receipt file is missing for ${receiptId}.`);
  }
}

export async function writeReceipt(repoRoot: string, payload: ReceiptPayload): Promise<Receipt> {
  const target = paths(repoRoot);
  const id = contentHash(payload);
  const receipt: Receipt = { id, ...payload };
  const receiptPath = path.join(target.receipts, receiptFileName(id));

  try {
    const existing = parseReceipt(JSON.parse(await readFile(receiptPath, 'utf8')) as unknown, id);
    if (canonicalStringify(existing) !== canonicalStringify(receipt)) {
      throw new IntegrityError(`Existing receipt file for ${id} is inconsistent.`);
    }
  } catch (error) {
    if (error instanceof IntegrityError || error instanceof SyntaxError) {
      throw error instanceof SyntaxError
        ? new IntegrityError(`Existing receipt ${id} is not valid JSON.`)
        : error;
    }
    await atomicWrite(receiptPath, `${canonicalStringify(receipt)}\n`);
  }

  const lock = await readEvidenceLock(repoRoot);
  if (!lock.receipts.includes(id)) {
    const next: EvidenceLock = {
      schemaVersion: LOCK_SCHEMA_VERSION,
      receipts: [...lock.receipts, id].sort(),
    };
    await atomicWrite(target.lock, `${canonicalStringify(next)}\n`);
  }
  return receipt;
}
