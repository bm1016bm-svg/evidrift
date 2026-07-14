import { Chalk, type ChalkInstance } from 'chalk';

import { affectedCodeLabel } from './core.js';
import type { DemoResult } from './demo.js';
import { escapeOutputText } from './text.js';
import type { CheckResult, Receipt } from './types.js';

export interface RenderOptions {
  interactive?: boolean;
}

function terminalStyle(options: RenderOptions): ChalkInstance {
  return new Chalk({ level: options.interactive === true ? 1 : 0 });
}

function statusLabel(result: CheckResult, options: RenderOptions): string {
  const style = terminalStyle(options);
  if (options.interactive === true) {
    switch (result.status) {
      case 'pass':
        return style.green.bold('✅ PASS');
      case 'source_changed':
        return style.yellow.bold('⚠ WARNING source_changed');
      case 'contract_mismatch':
        return style.red.bold('❌ FAIL contract_mismatch');
      case 'integrity_error':
        return style.red.bold('❌ FAIL evidence_integrity');
      case 'unverifiable':
        return style.yellow.bold('⚠ WARNING unverifiable');
    }
  }
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

export function renderRecord(receipt: Receipt, options: RenderOptions = {}): string {
  const receiptId = escapeOutputText(receipt.id);
  const recorded =
    options.interactive === true ? terminalStyle(options).green.bold('✅ RECORDED') : 'RECORDED';
  return [
    `${recorded} ${receiptId}`,
    `Claim: ${escapeOutputText(receipt.claim)}`,
    `Expected signature: ${escapeOutputText(receipt.evidence.expectedSignature)}`,
    `Affected code location: ${escapeOutputText(affectedCodeLabel(receipt.affectedCode.path, receipt.affectedCode.line))}`,
    `Receipt ID: ${receiptId}`,
    `Receipt file: .litmo/receipts/${escapeOutputText(receipt.id.slice('sha256:'.length))}.json`,
    'State: recorded evidence; no verified or runtime-correctness claim was stored.',
  ].join('\n');
}

export function renderResult(result: CheckResult, options: RenderOptions = {}): string {
  const receiptId = escapeOutputText(result.receiptId);
  const lines = [
    `${statusLabel(result, options)} ${receiptId}`,
    `Message: ${escapeOutputText(result.message)}`,
  ];
  if (result.claim !== undefined) {
    lines.push(`Claim: ${escapeOutputText(result.claim)}`);
  }
  if (result.expectedSignature !== undefined) {
    lines.push(`Expected signature: ${escapeOutputText(result.expectedSignature)}`);
  }
  if (result.currentSignature !== undefined) {
    lines.push(`Current signature: ${escapeOutputText(result.currentSignature)}`);
  }
  if (result.affectedCode !== undefined) {
    lines.push(
      `Affected code location: ${escapeOutputText(affectedCodeLabel(result.affectedCode.path, result.affectedCode.line))}`,
    );
  }
  lines.push(`Receipt ID: ${receiptId}`);
  if (result.expectedPackageVersion !== undefined) {
    lines.push(
      `Package version: expected ${escapeOutputText(result.expectedPackageVersion)}; current ${escapeOutputText(result.currentPackageVersion ?? 'unavailable')}`,
    );
  }
  if (result.expectedResolvedPath !== undefined) {
    lines.push(
      `Resolved path: expected ${escapeOutputText(result.expectedResolvedPath)}; current ${escapeOutputText(result.currentResolvedPath ?? 'unavailable')}`,
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
  if (result.status === 'integrity_error') {
    lines.push(
      'Action: Do not trust or hand-edit this Receipt. Restore it from version control, or intentionally create a new Receipt with `litmo record`.',
    );
  }
  return lines.join('\n');
}

export function renderCheck(results: readonly CheckResult[], options: RenderOptions = {}): string {
  const pass = results.filter((result) => result.status === 'pass').length;
  const warnings = results.filter(
    (result) => result.status === 'source_changed' || result.status === 'unverifiable',
  ).length;
  const failures = results.filter(
    (result) => result.status === 'contract_mismatch' || result.status === 'integrity_error',
  ).length;
  const style = terminalStyle(options);
  const body =
    results.length === 0
      ? [
          options.interactive === true
            ? style.green.bold('✅ PASS no receipts')
            : 'PASS no receipts',
        ]
      : results.map((result) => renderResult(result, options));
  const summary =
    options.interactive === true
      ? `Summary: ${style.green(`✅ ${pass} pass`)}  ${style.yellow(`⚠ ${warnings} warning`)}  ${style.red(`❌ ${failures} fail`)}`
      : `Summary: ${pass} pass, ${warnings} warning, ${failures} fail`;
  return [...body, summary].join('\n\n');
}

export function renderExplain(result: CheckResult, options: RenderOptions = {}): string {
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
    renderResult(result, options),
    '',
    `Evidence integrity: ${integrity}`,
    `Source drift: ${sourceDrift}`,
    `Semantic support: ${semanticSupport}`,
    'Runtime correctness: not evaluated by Litmo',
  ].join('\n');
}

export function renderDemo(result: DemoResult, options: RenderOptions = {}): string {
  const style = terminalStyle(options);
  const title =
    options.interactive === true
      ? style.cyan.bold('⚡ Litmo signature-drift demo')
      : 'Litmo signature-drift demo';
  const section = (value: string): string =>
    options.interactive === true ? style.cyan.bold(value) : value;
  const caught =
    options.interactive === true
      ? style.red.bold('❌ Litmo caught the dependency contract drift before merge.')
      : 'Litmo caught the dependency contract drift before merge.';
  return [
    title,
    `Workspace: ${escapeOutputText(result.workspace)}`,
    '',
    section('1/3 Evidence recorded'),
    renderRecord(result.receipt, options),
    '',
    section('2/3 Baseline contract'),
    renderCheck(result.baseline, options),
    '',
    section('3/3 Dependency signature changed on purpose'),
    renderCheck(result.drift, options),
    '',
    caught,
    'Next: inspect the generated .litmo-demo/signature-drift workspace or run `litmo demo` again.',
  ].join('\n');
}
