export const RECEIPT_SCHEMA_VERSION = 1 as const;
export const LOCK_SCHEMA_VERSION = 1 as const;
export const EVIDRIFT_VERSION = '0.3.0';

export interface AffectedCode {
  path: string;
  line?: number;
}

export interface TypeScriptSymbolEvidence {
  adapter: 'typescript.symbol';
  projectRoot: string;
  package: {
    name: string;
    version: string;
    resolvedPath: string;
  };
  symbol: string;
  parameter?: string;
  expectedSignature: string;
  signatureHash: string;
}

export interface JsonPointerEvidence {
  adapter: 'json.pointer';
  sourcePath: string;
  pointer: string;
  expectedValue: string;
  valueHash: string;
  sourceHash: string;
}

export type Evidence = TypeScriptSymbolEvidence | JsonPointerEvidence;

export interface ReceiptPayload {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  claim: string;
  affectedCode: AffectedCode;
  evidence: Evidence;
}

export interface Receipt extends ReceiptPayload {
  id: string;
}

export interface EvidenceLock {
  schemaVersion: typeof LOCK_SCHEMA_VERSION;
  receipts: string[];
}

export interface ResolvedTypeScriptSymbol {
  packageName: string;
  packageVersion: string;
  resolvedPath: string;
  symbol: string;
  parameter?: string;
  parameterPresent?: boolean;
  signature: string;
  signatureHash: string;
}

export interface ResolvedJsonPointer {
  sourcePath: string;
  pointer: string;
  value: string;
  valueHash: string;
  sourceHash: string;
}

export type CheckStatus =
  'pass' | 'source_changed' | 'contract_mismatch' | 'integrity_error' | 'unverifiable';

export interface CheckResult {
  receiptId: string;
  status: CheckStatus;
  blocking: boolean;
  claim?: string;
  expectedSignature?: string;
  currentSignature?: string;
  expectedJsonValue?: string;
  currentJsonValue?: string;
  sourcePath?: string;
  expectedSourceHash?: string;
  currentSourceHash?: string;
  affectedCode?: AffectedCode;
  expectedPackageVersion?: string;
  currentPackageVersion?: string;
  expectedResolvedPath?: string;
  currentResolvedPath?: string;
  message: string;
}

interface RecordBase {
  repoRoot: string;
  claim: string;
  affectedCode: AffectedCode;
}

export interface TypeScriptRecordInput extends RecordBase {
  projectRoot: string;
  packageName: string;
  symbol: string;
  parameter?: string;
  overload?: number;
}

export interface JsonPointerRecordInput extends RecordBase {
  jsonPath: string;
  pointer: string;
}

export type RecordInput = TypeScriptRecordInput | JsonPointerRecordInput;
