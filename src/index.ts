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
  EvidenceLock,
  Receipt,
  ReceiptPayload,
  RecordInput,
  TypeScriptSymbolEvidence,
} from './types.js';
