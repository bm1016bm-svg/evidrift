import { affectedCodeLabel } from './core.js';
import type { CheckResult, Receipt } from './types.js';

function statusLabel(result: CheckResult): string {
  switch (result.status) {
    case 'pass':
      return 'PASS';
    case 'source_changed':
      return 'WARNING source_changed';
    case 'contract_mismatch':
      return 'FAIL contract_mismatch';
    case 'integrity_error':
      return 'FAIL evidence_integrity';
    case 'unverifiable':
      return 'WARNING unverifiable';
  }
}

export function renderRecord(receipt: Receipt): string {
  return [
    `RECORDED ${receipt.id}`,
    `Claim: ${receipt.claim}`,
    `Expected signature: ${receipt.evidence.expectedSignature}`,
    `Affected code location: ${affectedCodeLabel(receipt.affectedCode.path, receipt.affectedCode.line)}`,
    `Receipt ID: ${receipt.id}`,
    `Receipt file: .litmo/receipts/${receipt.id.slice('sha256:'.length)}.json`,
    'State: recorded evidence; no verified or runtime-correctness claim was stored.',
  ].join('\n');
}

export function renderResult(result: CheckResult): string {
  const lines = [`${statusLabel(result)} ${result.receiptId}`, `Message: ${result.message}`];
  if (result.claim !== undefined) {
    lines.push(`Claim: ${result.claim}`);
  }
  if (result.expectedSignature !== undefined) {
    lines.push(`Expected signature: ${result.expectedSignature}`);
  }
  if (result.currentSignature !== undefined) {
    lines.push(`Current signature: ${result.currentSignature}`);
  }
  if (result.affectedCode !== undefined) {
    lines.push(
      `Affected code location: ${affectedCodeLabel(result.affectedCode.path, result.affectedCode.line)}`,
    );
  }
  lines.push(`Receipt ID: ${result.receiptId}`);
  if (result.expectedPackageVersion !== undefined) {
    lines.push(
      `Package version: expected ${result.expectedPackageVersion}; current ${result.currentPackageVersion ?? 'unavailable'}`,
    );
  }
  if (result.expectedResolvedPath !== undefined) {
    lines.push(
      `Resolved path: expected ${result.expectedResolvedPath}; current ${result.currentResolvedPath ?? 'unavailable'}`,
    );
  }
  if (result.status === 'contract_mismatch') {
    lines.push(
      'Action: Review the dependency change and affected code, then intentionally record a new receipt.',
    );
  }
  if (result.status === 'source_changed') {
    lines.push(
      'Action: Review the source identity change; it is non-blocking because the contract matches.',
    );
  }
  if (result.status === 'unverifiable') {
    lines.push(
      'Action: Restore the dependency source and rerun check; v0.1 reports this as non-blocking.',
    );
  }
  return lines.join('\n');
}

export function renderCheck(results: readonly CheckResult[]): string {
  const pass = results.filter((result) => result.status === 'pass').length;
  const warnings = results.filter(
    (result) => result.status === 'source_changed' || result.status === 'unverifiable',
  ).length;
  const failures = results.filter(
    (result) => result.status === 'contract_mismatch' || result.status === 'integrity_error',
  ).length;
  const body = results.length === 0 ? ['PASS no receipts'] : results.map(renderResult);
  return [...body, `Summary: ${pass} pass, ${warnings} warning, ${failures} fail`].join('\n\n');
}

export function renderExplain(result: CheckResult): string {
  const integrity = result.status === 'integrity_error' ? 'invalid' : 'valid';
  const sourceDrift =
    result.status === 'source_changed'
      ? 'changed (non-blocking contract match)'
      : result.status === 'unverifiable'
        ? 'unverifiable'
        : 'not observed';
  const semanticSupport =
    result.status === 'contract_mismatch'
      ? 'deterministic contract mismatch'
      : result.status === 'pass' || result.status === 'source_changed'
        ? 'deterministic contract match; free-text claim not semantically proven'
        : 'not established';
  return [
    renderResult(result),
    '',
    `Evidence integrity: ${integrity}`,
    `Source drift: ${sourceDrift}`,
    `Semantic support: ${semanticSupport}`,
    'Runtime correctness: not evaluated by Litmo',
  ].join('\n');
}
