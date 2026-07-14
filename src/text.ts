const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const UNSAFE_CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f-\u009f]/gu;

export function hasUnsafeControlCharacters(value: string): boolean {
  return UNSAFE_CONTROL_CHARACTERS.test(value);
}

export function escapeOutputText(value: string): string {
  return value.replace(UNSAFE_CONTROL_CHARACTERS_GLOBAL, (character) => {
    switch (character) {
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0') ?? 'fffd'}`;
    }
  });
}
