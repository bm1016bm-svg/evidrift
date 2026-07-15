export const RECEIPT_SCHEMA_VERSION = 1 as const;
export const LOCK_SCHEMA_VERSION = 1 as const;
export const EVIDRIFT_VERSION = '0.2.0';

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

export interface ReceiptPayload {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  claim: string;
  affectedCode: AffectedCode;
  evidence: TypeScriptSymbolEvidence;
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

export type CheckStatus =
  'pass' | 'source_changed' | 'contract_mismatch' | 'integrity_error' | 'unverifiable';

export interface CheckResult {
  receiptId: string;
  status: CheckStatus;
  blocking: boolean;
  claim?: string;
  expectedSignature?: string;
  currentSignature?: string;
  affectedCode?: AffectedCode;
  expectedPackageVersion?: string;
  currentPackageVersion?: string;
  expectedResolvedPath?: string;
  currentResolvedPath?: string;
  message: string;
}

export interface RecordInput {
  repoRoot: string;
  projectRoot: string;
  packageName: string;
  symbol: string;
  parameter?: string;
  overload?: number;
  claim: string;
  affectedCode: AffectedCode;
}
