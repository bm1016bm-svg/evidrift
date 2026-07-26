import { canonicalStringify, sha256 } from './canonical.js';

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface MinimizeJsonOptions {
  maxProbes?: number;
  probe: (candidate: JsonValue) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface MinimizeJsonResult {
  value: JsonValue;
  probes: number;
  accepted: number;
  exhausted: boolean;
  originalBytes: number;
  minimizedBytes: number;
}

export class ReproductionMismatchError extends Error {
  override name = 'ReproductionMismatchError';
}

const DEFAULT_MAX_PROBES = 100;
const MAX_MAX_PROBES = 500;

function jsonBytes(value: JsonValue): number {
  return Buffer.byteLength(canonicalStringify(value), 'utf8');
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJson(item)]));
  }
  return value;
}

function chunks(length: number, granularity: number): Array<[number, number]> {
  const size = Math.ceil(length / granularity);
  const result: Array<[number, number]> = [];
  for (let start = 0; start < length; start += size) {
    result.push([start, Math.min(start + size, length)]);
  }
  return result;
}

interface ProbeState {
  accepted: number;
  cache: Map<string, boolean>;
  exhausted: boolean;
  maxProbes: number;
  probes: number;
  rawProbe: (candidate: JsonValue) => Promise<boolean>;
  signal?: AbortSignal;
}

async function evaluate(state: ProbeState, candidate: JsonValue): Promise<boolean | undefined> {
  state.signal?.throwIfAborted();
  const key = sha256(canonicalStringify(candidate));
  const cached = state.cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  if (state.probes >= state.maxProbes) {
    state.exhausted = true;
    return undefined;
  }
  state.probes += 1;
  const matches = await state.rawProbe(cloneJson(candidate));
  state.cache.set(key, matches);
  return matches;
}

async function minimizeSequence<T>(
  initial: readonly T[],
  test: (candidate: readonly T[]) => Promise<boolean | undefined>,
  state: ProbeState,
): Promise<T[]> {
  let current = [...initial];
  let granularity = 2;

  while (current.length > 0 && !state.exhausted) {
    let reduced = false;
    for (const [start, end] of chunks(current.length, granularity)) {
      const candidate = [...current.slice(0, start), ...current.slice(end)];
      const matches = await test(candidate);
      if (matches === undefined) {
        return current;
      }
      if (matches) {
        current = candidate;
        state.accepted += 1;
        granularity = Math.max(2, granularity - 1);
        reduced = true;
        break;
      }
    }
    if (reduced) {
      continue;
    }
    if (granularity >= current.length) {
      break;
    }
    granularity = Math.min(current.length, granularity * 2);
  }

  return current;
}

async function minimizeNode(
  initial: JsonValue,
  test: (candidate: JsonValue) => Promise<boolean | undefined>,
  state: ProbeState,
): Promise<JsonValue> {
  if (state.exhausted) {
    return initial;
  }

  if (Array.isArray(initial)) {
    const current = await minimizeSequence(
      initial,
      (candidate) => test(candidate.map((item) => cloneJson(item))),
      state,
    );
    for (let index = 0; index < current.length && !state.exhausted; index += 1) {
      const item = current[index];
      if (item === undefined) {
        continue;
      }
      const minimized = await minimizeNode(
        item,
        (candidateItem) => {
          const candidate = current.map((value) => cloneJson(value));
          candidate[index] = candidateItem;
          return test(candidate);
        },
        state,
      );
      current[index] = minimized;
    }
    return current;
  }

  if (initial !== null && typeof initial === 'object') {
    let current = cloneJson(initial) as { [key: string]: JsonValue };
    const remainingKeys = await minimizeSequence(
      Object.keys(current),
      async (keys) => {
        const allowed = new Set(keys);
        const candidate = Object.fromEntries(
          Object.entries(current)
            .filter(([key]) => allowed.has(key))
            .map(([key, value]) => [key, cloneJson(value)]),
        );
        return test(candidate);
      },
      state,
    );
    const allowed = new Set(remainingKeys);
    current = Object.fromEntries(Object.entries(current).filter(([key]) => allowed.has(key)));

    for (const key of remainingKeys) {
      if (state.exhausted || !Object.prototype.hasOwnProperty.call(current, key)) {
        break;
      }
      const minimized = await minimizeNode(
        current[key] as JsonValue,
        (candidateValue) => test({ ...current, [key]: candidateValue }),
        state,
      );
      current[key] = minimized;
    }
    return current;
  }

  if (typeof initial === 'string') {
    const characters = await minimizeSequence(
      Array.from(initial),
      (candidate) => test(candidate.join('')),
      state,
    );
    return characters.join('');
  }

  if (typeof initial === 'number') {
    const initialBytes = jsonBytes(initial);
    const candidates = [0, 1, -1, Math.trunc(initial)]
      .filter((value, index, values) => Number.isFinite(value) && values.indexOf(value) === index)
      .filter((value) => value !== initial)
      .filter(
        (value) =>
          jsonBytes(value) < initialBytes ||
          (jsonBytes(value) === initialBytes && Math.abs(value) < Math.abs(initial)),
      )
      .sort(
        (left, right) => jsonBytes(left) - jsonBytes(right) || Math.abs(left) - Math.abs(right),
      );
    for (const candidate of candidates) {
      const matches = await test(candidate);
      if (matches === undefined) {
        break;
      }
      if (matches) {
        state.accepted += 1;
        return candidate;
      }
    }
  }

  return initial;
}

export async function minimizeJsonValue(
  value: JsonValue,
  options: MinimizeJsonOptions,
): Promise<MinimizeJsonResult> {
  const maxProbes = options.maxProbes ?? DEFAULT_MAX_PROBES;
  if (!Number.isSafeInteger(maxProbes) || maxProbes < 1 || maxProbes > MAX_MAX_PROBES) {
    throw new RangeError(`maxProbes must be an integer between 1 and ${MAX_MAX_PROBES}.`);
  }

  const original = cloneJson(value);
  const state: ProbeState = {
    accepted: 0,
    cache: new Map(),
    exhausted: false,
    maxProbes,
    probes: 0,
    rawProbe: options.probe,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const baseline = await evaluate(state, original);
  if (baseline !== true) {
    throw new ReproductionMismatchError(
      'The original JSON does not satisfy the selected failure predicate.',
    );
  }

  let minimized = original;
  while (!state.exhausted) {
    const before = canonicalStringify(minimized);
    minimized = await minimizeNode(minimized, (candidate) => evaluate(state, candidate), state);
    if (canonicalStringify(minimized) === before) {
      break;
    }
  }
  return {
    value: minimized,
    probes: state.probes,
    accepted: state.accepted,
    exhausted: state.exhausted,
    originalBytes: jsonBytes(original),
    minimizedBytes: jsonBytes(minimized),
  };
}
