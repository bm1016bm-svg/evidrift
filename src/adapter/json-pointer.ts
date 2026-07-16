import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { canonicalStringify, sha256 } from '../canonical.js';
import { JsonPointerSyntaxError, parseJsonPointer, readJsonPointer } from '../json-pointer.js';
import { assertSafeRelativePath, isInside, relativeToRepo, resolveInside } from '../paths.js';
import { hasUnsafeControlCharacters } from '../text.js';
import type { ResolvedJsonPointer } from '../types.js';

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_POINTER_CHARACTERS = 4096;
const MAX_VALUE_CHARACTERS = 1024 * 1024;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;

export class JsonPointerError extends Error {
  override name = 'JsonPointerError';
}

export class JsonPointerMismatchError extends JsonPointerError {
  override name = 'JsonPointerMismatchError';

  constructor(
    message: string,
    readonly currentValue: string,
  ) {
    super(message);
  }
}

export function validateJsonPointer(pointer: unknown): string {
  if (
    typeof pointer !== 'string' ||
    pointer.length > MAX_POINTER_CHARACTERS ||
    hasUnsafeControlCharacters(pointer)
  ) {
    throw new JsonPointerError(
      `JSON Pointer must contain 0-${MAX_POINTER_CHARACTERS} safe text characters.`,
    );
  }
  try {
    parseJsonPointer(pointer);
  } catch (error) {
    throw new JsonPointerError(error instanceof Error ? error.message : String(error));
  }
  return pointer;
}

export interface ResolveJsonPointerInput {
  repoRoot: string;
  sourcePath: string;
  pointer: string;
  expectedValueHash?: string;
}

export async function resolveJsonPointer(
  input: ResolveJsonPointerInput,
): Promise<ResolvedJsonPointer> {
  const repoRoot = await realpath(input.repoRoot);
  if (/^(?:\.\/)?[a-z][a-z0-9+.-]*:[/\\]/iu.test(input.sourcePath)) {
    throw new JsonPointerError('JSON source must be a repository-local `.json` path, not a URL.');
  }
  const sourcePath = assertSafeRelativePath(input.sourcePath, 'JSON source', false);
  if (path.extname(sourcePath).toLowerCase() !== '.json') {
    throw new JsonPointerError('JSON source must use a `.json` extension.');
  }
  const pointer = validateJsonPointer(input.pointer);
  if (input.expectedValueHash !== undefined && !SHA256_ID.test(input.expectedValueHash)) {
    throw new JsonPointerError('Expected JSON value hash must be a full sha256 hash.');
  }

  const candidate = resolveInside(repoRoot, sourcePath, 'JSON source');
  let metadata;
  try {
    metadata = await lstat(candidate);
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      throw new JsonPointerError(`JSON source was not found: ${sourcePath}.`);
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new JsonPointerError('JSON source must be a regular file, not a symlink.');
  }
  if (metadata.size > MAX_JSON_BYTES) {
    throw new JsonPointerError(`JSON source exceeds the ${MAX_JSON_BYTES}-byte limit.`);
  }
  const resolved = await realpath(candidate);
  if (!isInside(repoRoot, resolved)) {
    throw new JsonPointerError('JSON source resolves outside the repository.');
  }

  let document: unknown;
  try {
    document = JSON.parse(await readFile(resolved, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new JsonPointerError(`JSON source ${sourcePath} is not valid JSON.`);
    }
    throw error;
  }

  let selected: unknown;
  try {
    selected = readJsonPointer(document, pointer);
  } catch (error) {
    if (error instanceof JsonPointerSyntaxError) {
      throw new JsonPointerMismatchError(
        error.message,
        `<missing JSON Pointer ${pointer || '(root)'}>`,
      );
    }
    throw error;
  }
  const value = canonicalStringify(selected);
  if (value.length > MAX_VALUE_CHARACTERS) {
    throw new JsonPointerError(
      `Selected JSON value exceeds the ${MAX_VALUE_CHARACTERS}-character Receipt limit.`,
    );
  }
  const valueHash = `sha256:${sha256(value)}`;
  if (input.expectedValueHash !== undefined && valueHash !== input.expectedValueHash) {
    throw new JsonPointerMismatchError(`JSON value changed at ${pointer || '(root)'}.`, value);
  }
  const canonicalSource = canonicalStringify(document);
  return {
    sourcePath: relativeToRepo(repoRoot, resolved),
    pointer,
    value,
    valueHash,
    sourceHash: `sha256:${sha256(canonicalSource)}`,
  };
}
