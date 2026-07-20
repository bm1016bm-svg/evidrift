import { checkExitCode } from './core.js';
import { EVIDRIFT_VERSION, type CheckResult } from './types.js';

export const CHECK_REPORT_SCHEMA_VERSION = 1 as const;

export interface CheckReportSummary {
  pass: number;
  warning: number;
  fail: number;
}

export interface CheckReport {
  schemaVersion: typeof CHECK_REPORT_SCHEMA_VERSION;
  tool: {
    name: 'evidrift';
    version: string;
  };
  command: 'check';
  exitCode: 0 | 1 | 2;
  summary: CheckReportSummary;
  results: readonly CheckResult[];
}

export function createCheckReport(results: readonly CheckResult[]): CheckReport {
  return {
    schemaVersion: CHECK_REPORT_SCHEMA_VERSION,
    tool: {
      name: 'evidrift',
      version: EVIDRIFT_VERSION,
    },
    command: 'check',
    exitCode: checkExitCode(results),
    summary: {
      pass: results.filter((result) => result.status === 'pass').length,
      warning: results.filter(
        (result) => result.status === 'source_changed' || result.status === 'unverifiable',
      ).length,
      fail: results.filter(
        (result) => result.status === 'contract_mismatch' || result.status === 'integrity_error',
      ).length,
    },
    results,
  };
}

export function renderCheckReport(results: readonly CheckResult[]): string {
  return JSON.stringify(createCheckReport(results), null, 2);
}
