import path from 'node:path';

import { hasUnsafeControlCharacters } from './text.js';

export class PathSafetyError extends Error {
  override name = 'PathSafetyError';
}

export function normalizeRelativePath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function assertSafeRelativePath(value: string, label: string, allowDot = true): string {
  if (!value || hasUnsafeControlCharacters(value) || path.isAbsolute(value)) {
    throw new PathSafetyError(`${label} must be a repository-relative path.`);
  }

  const normalized = normalizeRelativePath(path.normalize(value));
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new PathSafetyError(`${label} must stay inside the repository.`);
  }
  if (!allowDot && normalized === '.') {
    throw new PathSafetyError(`${label} must name a file.`);
  }
  return normalized;
}

export function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveInside(parent: string, value: string, label: string): string {
  const absolute = path.resolve(parent, value);
  if (!isInside(path.resolve(parent), absolute)) {
    throw new PathSafetyError(`${label} must stay inside the repository.`);
  }
  return absolute;
}

export function relativeToRepo(repoRoot: string, absolute: string): string {
  if (!isInside(path.resolve(repoRoot), path.resolve(absolute))) {
    throw new PathSafetyError('Resolved evidence must stay inside the repository.');
  }
  const relative = path.relative(repoRoot, absolute);
  return relative === '' ? '.' : normalizeRelativePath(relative);
}

export function receiptFileName(receiptId: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(receiptId);
  if (!match?.[1]) {
    throw new PathSafetyError('Receipt ID must be a full sha256 content hash.');
  }
  return `${match[1]}.json`;
}
