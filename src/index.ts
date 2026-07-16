export {
  checkExitCode,
  checkRepository,
  explainEvidence,
  initEvidrift,
  recordEvidence,
} from './core.js';
export { canonicalStringify, contentHash, sha256 } from './canonical.js';
export { IntegrityError, parseReceipt } from './storage.js';
export type {
  CheckResult,
  Evidence,
  EvidenceLock,
  JsonPointerEvidence,
  JsonPointerRecordInput,
  Receipt,
  ReceiptPayload,
  RecordInput,
  TypeScriptRecordInput,
  TypeScriptSymbolEvidence,
} from './types.js';
