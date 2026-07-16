const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/u;

export class JsonPointerSyntaxError extends Error {
  override name = 'JsonPointerSyntaxError';
}

export function parseJsonPointer(pointer: string): string[] {
  if (pointer === '') {
    return [];
  }
  if (!pointer.startsWith('/')) {
    throw new JsonPointerSyntaxError('JSON Pointer must be empty or start with `/`.');
  }
  return pointer
    .slice(1)
    .split('/')
    .map((token) => {
      if (/~(?:[^01]|$)/u.test(token)) {
        throw new JsonPointerSyntaxError('JSON Pointer uses an invalid `~` escape.');
      }
      return token.replaceAll('~1', '/').replaceAll('~0', '~');
    });
}

export function readJsonPointer(document: unknown, pointer: string): unknown {
  let current = document;
  for (const token of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(token)) {
        throw new JsonPointerSyntaxError(
          `JSON Pointer array token ${JSON.stringify(token)} is not a valid index.`,
        );
      }
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) {
        throw new JsonPointerSyntaxError(`JSON Pointer array index ${token} does not exist.`);
      }
      current = current[index];
      continue;
    }
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      throw new JsonPointerSyntaxError(
        `JSON Pointer token ${JSON.stringify(token)} does not exist.`,
      );
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}
