export function parseConfig(input, options = {}) {
  return { value: options.strict ? input.trim() : input };
}
