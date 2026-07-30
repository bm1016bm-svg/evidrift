import type { CheckResult } from './types.js';

function escapeCommandData(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeCommandProperty(value: string): string {
  return escapeCommandData(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function annotationLevel(result: CheckResult): 'error' | 'warning' | undefined {
  switch (result.status) {
    case 'contract_mismatch':
    case 'integrity_error':
      return 'error';
    case 'source_changed':
    case 'unverifiable':
      return 'warning';
    case 'pass':
      return undefined;
  }
}

function annotationTitle(result: CheckResult): string {
  switch (result.status) {
    case 'contract_mismatch':
      return 'Evidrift contract mismatch';
    case 'integrity_error':
      return 'Evidrift evidence integrity failure';
    case 'source_changed':
      return 'Evidrift source changed';
    case 'unverifiable':
      return 'Evidrift evidence unavailable';
    case 'pass':
      return 'Evidrift check passed';
  }
}

export function renderGitHubAnnotation(result: CheckResult): string | undefined {
  const level = annotationLevel(result);
  if (level === undefined) {
    return undefined;
  }

  const properties = [`title=${escapeCommandProperty(annotationTitle(result))}`];
  if (result.affectedCode !== undefined) {
    properties.push(`file=${escapeCommandProperty(result.affectedCode.path)}`);
    if (result.affectedCode.line !== undefined) {
      properties.push(`line=${result.affectedCode.line}`);
    }
  }

  const detail = [
    result.message,
    ...(result.claim === undefined ? [] : [`Claim: ${result.claim}`]),
    `Receipt: ${result.receiptId}`,
  ].join(' ');
  return `::${level} ${properties.join(',')}::${escapeCommandData(detail)}`;
}

export function renderGitHubAnnotations(results: readonly CheckResult[]): string {
  return results
    .map((result) => renderGitHubAnnotation(result))
    .filter((annotation): annotation is string => annotation !== undefined)
    .join('\n');
}
