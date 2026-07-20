export {
  checkExitCode,
  checkRepository,
  explainEvidence,
  initEvidrift,
  recordEvidence,
} from './core.js';
export { canonicalStringify, contentHash, sha256 } from './canonical.js';
export { CHECK_REPORT_SCHEMA_VERSION, createCheckReport, renderCheckReport } from './report.js';
export { IntegrityError, parseReceipt } from './storage.js';
export type { CheckReport, CheckReportSummary } from './report.js';
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
