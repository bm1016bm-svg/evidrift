import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalStringify, contentHash } from './canonical.js';
import { parseJsonPointer, readJsonPointer } from './json-pointer.js';
import { assertSafeRelativePath, isInside, resolveInside } from './paths.js';
import {
  minimizeJsonValue,
  ReproductionMismatchError,
  type JsonValue,
  type MinimizeJsonResult,
} from './repro.js';
import { hasUnsafeControlCharacters } from './text.js';
import { EVIDRIFT_VERSION } from './types.js';

export const REPRO_REQUEST_SCHEMA_VERSION = 1 as const;
export const REPRO_ARTIFACT_SCHEMA_VERSION = 1 as const;

const MAX_FIXTURE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 10_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PROBES = 100;
const MAX_MAX_PROBES = 500;
const MIN_MINIMIZE_PROBES = 2;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const ALLOWED_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const BLOCKED_HEADERS =
  /^(?:authorization|connection|content-length|cookie|host|proxy-authorization|set-cookie|transfer-encoding|x-api-key)$/iu;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const SECRET_VALUE_PATTERNS = [
  /(?:^|\s)(?:basic|bearer)\s+\S{6,}/iu,
  /\bsk-[A-Za-z0-9_-]{6,}\b/u,
  /\bgh(?:o|p|r|s|u)_[A-Za-z0-9]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u,
] as const;

export interface HttpRequestFixture {
  schemaVersion: typeof REPRO_REQUEST_SCHEMA_VERSION;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers: Record<string, string>;
  body: JsonValue;
}

export type FailurePredicate =
  | {
      status: number;
      responseContains: string;
    }
  | {
      status: number;
      responsePointer: string;
      responseEquals: JsonValue;
    };

export interface ProbeObservation {
  status: number;
  contentType?: string;
  matched: boolean;
}

export interface ReproductionArtifact {
  schemaVersion: typeof REPRO_ARTIFACT_SCHEMA_VERSION;
  reproId: string;
  tool: {
    name: 'evidrift';
    version: string;
  };
  request: HttpRequestFixture;
  predicate: FailurePredicate;
  evidence: {
    claim:
      | '1-minimal under the selected JSON reducers and failure predicate'
      | 'smallest verified candidate found before the probe budget was exhausted';
    originalBodyHash: string;
    minimizedBodyHash: string;
    originalBytes: number;
    minimizedBytes: number;
    probes: number;
    acceptedReductions: number;
    budgetExhausted: boolean;
    baselineStatus: number;
    finalStatus: number;
  };
}

export interface MinimizeHttpOptions {
  confirmReplay: boolean;
  maxProbes?: number;
  timeoutMs?: number;
}

export class ReproSafetyError extends Error {
  override name = 'ReproSafetyError';
}

export class ProbeUnavailableError extends Error {
  override name = 'ProbeUnavailableError';
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function exactObject(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknown[0])}.`);
  }
  return record;
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  let nodes = 0;
  const ancestors = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      throw new RangeError(`JSON body contains more than ${MAX_JSON_NODES} nodes.`);
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new RangeError(`JSON body is deeper than ${MAX_JSON_DEPTH} levels.`);
    }
    if (candidate === null || typeof candidate === 'boolean' || typeof candidate === 'string') {
      return;
    }
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        throw new TypeError('JSON body contains a non-finite number.');
      }
      return;
    }
    if (Array.isArray(candidate)) {
      if (ancestors.has(candidate)) {
        throw new TypeError('JSON body must not contain a circular reference.');
      }
      ancestors.add(candidate);
      try {
        for (const item of candidate) {
          visit(item, depth + 1);
        }
      } finally {
        ancestors.delete(candidate);
      }
      return;
    }
    if (typeof candidate === 'object') {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('JSON body objects must use a plain object prototype.');
      }
      if (ancestors.has(candidate)) {
        throw new TypeError('JSON body must not contain a circular reference.');
      }
      ancestors.add(candidate);
      try {
        for (const item of Object.values(candidate as Record<string, unknown>)) {
          visit(item, depth + 1);
        }
      } finally {
        ancestors.delete(candidate);
      }
      return;
    }
    throw new TypeError(`JSON body contains unsupported ${typeof candidate} data.`);
  };
  visit(value, 0);
}

function secretShapedName(value: string, rejectBareKey = false): boolean {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/gu, '');
  if (rejectBareKey && compact === 'key') {
    return true;
  }
  return [
    'accesskey',
    'accesstoken',
    'apikey',
    'auth',
    'authentication',
    'authorization',
    'clientsecret',
    'credential',
    'credentials',
    'password',
    'passwd',
    'privatekey',
    'pwd',
    'refreshtoken',
    'secret',
    'token',
  ].some((suffix) => compact === suffix || compact.endsWith(suffix));
}

function assertNoSecretLikeString(value: string, label: string): void {
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new ReproSafetyError(
      `${label} looks secret-bearing; replace it with synthetic local fixture data.`,
    );
  }
}

function assertNoSecretLikeJson(value: JsonValue, label: string): void {
  if (typeof value === 'string') {
    assertNoSecretLikeString(value, label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikeJson(item, `${label}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (secretShapedName(key)) {
        throw new ReproSafetyError(
          `${label} field ${JSON.stringify(key)} looks secret-bearing; use synthetic fixture data.`,
        );
      }
      assertNoSecretLikeJson(item, `${label}.${key}`);
    }
  }
}

function assertLoopbackUrl(value: string): URL {
  if (value.length > 2_048 || hasUnsafeControlCharacters(value)) {
    throw new ReproSafetyError('Request URL must contain at most 2048 safe characters.');
  }
  if (!/^http:\/\/(?:127(?:\.[0-9]{1,3}){3}|\[::1\])(?::[0-9]+)?(?:[/?#]|$)/iu.test(value)) {
    throw new ReproSafetyError(
      'ReproMin MVP only permits literal dotted 127.0.0.0/8 or bracketed ::1 loopback addresses.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ReproSafetyError('Request URL must be a valid absolute URL.');
  }
  if (url.protocol !== 'http:') {
    throw new ReproSafetyError('ReproMin MVP only permits plain HTTP on a loopback address.');
  }
  if (url.username || url.password) {
    throw new ReproSafetyError('Request URL must not contain credentials.');
  }
  if (url.hash) {
    throw new ReproSafetyError('Request URL must not contain a fragment.');
  }
  for (const [key, queryValue] of url.searchParams) {
    if (secretShapedName(key, true)) {
      throw new ReproSafetyError(
        `Request query parameter ${JSON.stringify(key)} looks secret-bearing; use a disposable local fixture without secrets.`,
      );
    }
    assertNoSecretLikeString(queryValue, `Request query parameter ${JSON.stringify(key)} value`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
  const addressFamily = isIP(hostname);
  const loopback =
    (addressFamily === 4 && hostname.startsWith('127.')) ||
    (addressFamily === 6 && hostname === '::1');
  if (!loopback) {
    throw new ReproSafetyError(
      'ReproMin MVP only permits literal 127.0.0.0/8 or ::1 loopback addresses.',
    );
  }
  return url;
}

function normalizedHeaders(value: unknown): Record<string, string> {
  if (value === undefined) {
    return { 'content-type': 'application/json' };
  }
  const record = exactObject(value, 'Request headers', Object.keys(value as object));
  if (Object.keys(record).length > 32) {
    throw new RangeError('Request fixture contains more than 32 headers.');
  }

  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [rawName, rawValue] of Object.entries(record)) {
    const name = rawName.toLowerCase();
    if (!HEADER_NAME.test(rawName) || rawName.length > 128) {
      throw new ReproSafetyError(`Request header name ${JSON.stringify(rawName)} is invalid.`);
    }
    if (BLOCKED_HEADERS.test(name) || secretShapedName(name, true)) {
      throw new ReproSafetyError(
        `Request header ${JSON.stringify(rawName)} is not allowed in a reproduction artifact.`,
      );
    }
    if (
      typeof rawValue !== 'string' ||
      rawValue.length > 1024 ||
      hasUnsafeControlCharacters(rawValue)
    ) {
      throw new ReproSafetyError(
        `Request header ${JSON.stringify(rawName)} must have a safe string value of at most 1024 characters.`,
      );
    }
    assertNoSecretLikeString(rawValue, `Request header ${JSON.stringify(rawName)}`);
    if (Object.prototype.hasOwnProperty.call(headers, name)) {
      throw new ReproSafetyError(
        `Request header ${JSON.stringify(rawName)} duplicates another header name.`,
      );
    }
    headers[name] = rawValue;
  }

  const contentType = headers['content-type'] ?? 'application/json';
  if (!/^application\/(?:[A-Za-z0-9.+-]*\+)?json(?:\s*;.*)?$/iu.test(contentType)) {
    throw new ReproSafetyError('Request content-type must be application/json or a +json type.');
  }
  headers['content-type'] = contentType;
  return headers;
}

export function parseRequestFixture(value: unknown): HttpRequestFixture {
  const record = exactObject(value, 'Request fixture', [
    'schemaVersion',
    'url',
    'method',
    'headers',
    'body',
  ]);
  if (record.schemaVersion !== REPRO_REQUEST_SCHEMA_VERSION) {
    throw new TypeError(`Request fixture schemaVersion must be ${REPRO_REQUEST_SCHEMA_VERSION}.`);
  }
  if (typeof record.url !== 'string') {
    throw new TypeError('Request fixture url must be a string.');
  }
  assertLoopbackUrl(record.url);
  if (typeof record.method !== 'string' || !ALLOWED_METHODS.has(record.method.toUpperCase())) {
    throw new ReproSafetyError('Request method must be POST, PUT, or PATCH.');
  }
  const method = record.method.toUpperCase() as HttpRequestFixture['method'];
  assertJsonValue(record.body);
  if (record.body === null || typeof record.body !== 'object') {
    throw new TypeError('Request body must be a JSON object or array.');
  }
  assertNoSecretLikeJson(record.body, 'Request body');

  return {
    schemaVersion: REPRO_REQUEST_SCHEMA_VERSION,
    url: record.url,
    method,
    headers: normalizedHeaders(record.headers),
    body: record.body,
  };
}

export function parseFailurePredicate(value: unknown): FailurePredicate {
  const record = exactObject(value, 'Failure predicate', [
    'status',
    'responseContains',
    'responsePointer',
    'responseEquals',
  ]);
  if (
    typeof record.status !== 'number' ||
    !Number.isSafeInteger(record.status) ||
    record.status < 100 ||
    record.status > 599
  ) {
    throw new TypeError('Failure predicate status must be an integer between 100 and 599.');
  }
  if (record.responseContains !== undefined) {
    if (record.responsePointer !== undefined || record.responseEquals !== undefined) {
      throw new TypeError(
        'Failure predicate must use responseContains or responsePointer/responseEquals, not both.',
      );
    }
    if (
      typeof record.responseContains !== 'string' ||
      record.responseContains.length < 1 ||
      record.responseContains.length > 500 ||
      hasUnsafeControlCharacters(record.responseContains)
    ) {
      throw new TypeError('Failure predicate responseContains must contain 1-500 safe characters.');
    }
    assertNoSecretLikeString(record.responseContains, 'Failure predicate responseContains');
    return { status: record.status, responseContains: record.responseContains };
  }
  if (typeof record.responsePointer !== 'string' || record.responseEquals === undefined) {
    throw new TypeError(
      'Failure predicate requires responseContains or responsePointer with responseEquals.',
    );
  }
  parseJsonPointer(record.responsePointer);
  assertJsonValue(record.responseEquals);
  assertNoSecretLikeJson(record.responseEquals, 'Failure predicate responseEquals');
  return {
    status: record.status,
    responsePointer: record.responsePointer,
    responseEquals: record.responseEquals,
  };
}

function isLoopbackRemoteAddress(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.toLowerCase();
  return (
    normalized === '::1' || normalized.startsWith('127.') || normalized.startsWith('::ffff:127.')
  );
}

interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

async function sendRequest(
  fixture: HttpRequestFixture,
  body: JsonValue,
  timeoutMs: number,
): Promise<HttpResponse> {
  const url = assertLoopbackUrl(fixture.url);
  const serializedBody = JSON.stringify(body);
  const bodyBuffer = Buffer.from(serializedBody, 'utf8');
  if (bodyBuffer.byteLength > MAX_FIXTURE_BYTES) {
    throw new RangeError(`Serialized JSON body exceeds ${MAX_FIXTURE_BYTES} bytes.`);
  }

  return new Promise<HttpResponse>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (!settled) {
        settled = true;
        clearTimeout(wallClockTimer);
        callback();
      }
    };
    const request = httpRequest(
      url,
      {
        method: fixture.method,
        headers: {
          ...fixture.headers,
          accept: 'application/json, text/plain;q=0.9',
          'accept-encoding': 'identity',
          'content-length': String(bodyBuffer.byteLength),
        },
        agent: false,
      },
      (response) => {
        if (!isLoopbackRemoteAddress(response.socket.remoteAddress)) {
          response.destroy();
          settle(() =>
            reject(new ReproSafetyError('Connected HTTP peer is not a loopback address.')),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buffer.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            response.destroy();
            settle(() =>
              reject(
                new ProbeUnavailableError(
                  `HTTP response exceeds the ${MAX_RESPONSE_BYTES}-byte inspection limit.`,
                ),
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => {
          settle(() =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        });
        response.on('error', (error) => {
          settle(() => reject(new ProbeUnavailableError(`HTTP response failed: ${error.message}`)));
        });
      },
    );
    const wallClockTimer = setTimeout(() => {
      settle(() => {
        request.destroy();
        reject(new ProbeUnavailableError(`HTTP probe exceeded the ${timeoutMs} ms timeout.`));
      });
    }, timeoutMs);
    request.on('error', (error) => {
      settle(() => reject(new ProbeUnavailableError(`HTTP probe failed: ${error.message}`)));
    });
    request.end(bodyBuffer);
  });
}

function responseMatches(response: HttpResponse, predicate: FailurePredicate): boolean {
  if (response.status !== predicate.status) {
    return false;
  }
  if ('responseContains' in predicate) {
    return response.body.includes(predicate.responseContains);
  }
  let document: unknown;
  try {
    document = JSON.parse(response.body);
    assertJsonValue(document);
  } catch {
    return false;
  }
  try {
    return (
      canonicalStringify(readJsonPointer(document, predicate.responsePointer)) ===
      canonicalStringify(predicate.responseEquals)
    );
  } catch {
    return false;
  }
}

async function observe(
  fixture: HttpRequestFixture,
  body: JsonValue,
  predicate: FailurePredicate,
  timeoutMs: number,
): Promise<ProbeObservation> {
  const response = await sendRequest(fixture, body, timeoutMs);
  const rawContentType = response.headers['content-type'];
  const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
  return {
    status: response.status,
    ...(contentType === undefined ? {} : { contentType }),
    matched: responseMatches(response, predicate),
  };
}

function validatedOptions(options: MinimizeHttpOptions): {
  maxProbes: number;
  timeoutMs: number;
} {
  if (!options.confirmReplay) {
    throw new ReproSafetyError(
      'Repeated HTTP requests can change local state; pass --confirm-replay yes after reviewing the request and probe budget.',
    );
  }
  const maxProbes = options.maxProbes ?? DEFAULT_MAX_PROBES;
  if (!Number.isSafeInteger(maxProbes) || maxProbes < 1 || maxProbes > MAX_MAX_PROBES) {
    throw new RangeError(`maxProbes must be an integer between 1 and ${MAX_MAX_PROBES}.`);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be an integer between 100 and ${MAX_TIMEOUT_MS}.`);
  }
  return { maxProbes, timeoutMs };
}

function artifactId(
  tool: ReproductionArtifact['tool'],
  request: HttpRequestFixture,
  predicate: FailurePredicate,
  evidence: ReproductionArtifact['evidence'],
): string {
  return contentHash({
    schemaVersion: REPRO_ARTIFACT_SCHEMA_VERSION,
    tool,
    request,
    predicate,
    evidence,
  });
}

export async function minimizeHttpReproduction(
  fixtureValue: unknown,
  predicateValue: unknown,
  options: MinimizeHttpOptions,
): Promise<ReproductionArtifact> {
  const fixture = parseRequestFixture(fixtureValue);
  const predicate = parseFailurePredicate(predicateValue);
  const { maxProbes, timeoutMs } = validatedOptions(options);
  if (maxProbes < MIN_MINIMIZE_PROBES) {
    throw new RangeError(
      `maxProbes must be at least ${MIN_MINIMIZE_PROBES} so the baseline and final verification both fit inside the total request budget.`,
    );
  }

  let baselineStatus = 0;
  const reduction: MinimizeJsonResult = await minimizeJsonValue(fixture.body, {
    maxProbes: maxProbes - 1,
    probe: async (candidate) => {
      const observation = await observe(fixture, candidate, predicate, timeoutMs);
      if (baselineStatus === 0) {
        baselineStatus = observation.status;
      }
      return observation.matched;
    },
  });

  const finalObservation = await observe(fixture, reduction.value, predicate, timeoutMs);
  if (!finalObservation.matched) {
    throw new ReproductionMismatchError(
      'The minimized JSON did not satisfy the failure predicate during final verification.',
    );
  }
  const minimizedRequest: HttpRequestFixture = {
    ...fixture,
    body: reduction.value,
  };
  const tool: ReproductionArtifact['tool'] = {
    name: 'evidrift',
    version: EVIDRIFT_VERSION,
  };
  const evidence: ReproductionArtifact['evidence'] = {
    claim: reduction.exhausted
      ? 'smallest verified candidate found before the probe budget was exhausted'
      : '1-minimal under the selected JSON reducers and failure predicate',
    originalBodyHash: contentHash(fixture.body),
    minimizedBodyHash: contentHash(reduction.value),
    originalBytes: reduction.originalBytes,
    minimizedBytes: reduction.minimizedBytes,
    probes: reduction.probes + 1,
    acceptedReductions: reduction.accepted,
    budgetExhausted: reduction.exhausted,
    baselineStatus,
    finalStatus: finalObservation.status,
  };
  return {
    schemaVersion: REPRO_ARTIFACT_SCHEMA_VERSION,
    reproId: artifactId(tool, minimizedRequest, predicate, evidence),
    tool,
    request: minimizedRequest,
    predicate,
    evidence,
  };
}

export function parseReproductionArtifact(value: unknown): ReproductionArtifact {
  const record = exactObject(value, 'Reproduction artifact', [
    'schemaVersion',
    'reproId',
    'tool',
    'request',
    'predicate',
    'evidence',
  ]);
  if (record.schemaVersion !== REPRO_ARTIFACT_SCHEMA_VERSION) {
    throw new TypeError(
      `Reproduction artifact schemaVersion must be ${REPRO_ARTIFACT_SCHEMA_VERSION}.`,
    );
  }
  if (typeof record.reproId !== 'string') {
    throw new TypeError('Reproduction artifact reproId must be a string.');
  }
  const request = parseRequestFixture(record.request);
  const predicate = parseFailurePredicate(record.predicate);
  const tool = exactObject(record.tool, 'Reproduction artifact tool', ['name', 'version']);
  if (
    tool.name !== 'evidrift' ||
    typeof tool.version !== 'string' ||
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(tool.version)
  ) {
    throw new TypeError('Reproduction artifact tool metadata is invalid.');
  }
  const evidence = exactObject(record.evidence, 'Reproduction artifact evidence', [
    'claim',
    'originalBodyHash',
    'minimizedBodyHash',
    'originalBytes',
    'minimizedBytes',
    'probes',
    'acceptedReductions',
    'budgetExhausted',
    'baselineStatus',
    'finalStatus',
  ]);
  if (
    (evidence.claim !== '1-minimal under the selected JSON reducers and failure predicate' &&
      evidence.claim !==
        'smallest verified candidate found before the probe budget was exhausted') ||
    typeof evidence.originalBodyHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(evidence.originalBodyHash) ||
    typeof evidence.minimizedBodyHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(evidence.minimizedBodyHash) ||
    !Number.isSafeInteger(evidence.originalBytes) ||
    (evidence.originalBytes as number) < 0 ||
    (evidence.originalBytes as number) > MAX_FIXTURE_BYTES ||
    !Number.isSafeInteger(evidence.minimizedBytes) ||
    (evidence.minimizedBytes as number) < 0 ||
    (evidence.minimizedBytes as number) > (evidence.originalBytes as number) ||
    !Number.isSafeInteger(evidence.probes) ||
    (evidence.probes as number) < 2 ||
    (evidence.probes as number) > MAX_MAX_PROBES ||
    !Number.isSafeInteger(evidence.acceptedReductions) ||
    (evidence.acceptedReductions as number) < 0 ||
    (evidence.acceptedReductions as number) > (evidence.probes as number) ||
    typeof evidence.budgetExhausted !== 'boolean' ||
    !Number.isSafeInteger(evidence.baselineStatus) ||
    evidence.baselineStatus !== predicate.status ||
    !Number.isSafeInteger(evidence.finalStatus) ||
    evidence.finalStatus !== predicate.status ||
    (evidence.budgetExhausted === true &&
      evidence.claim !==
        'smallest verified candidate found before the probe budget was exhausted') ||
    (evidence.budgetExhausted === false &&
      evidence.claim !== '1-minimal under the selected JSON reducers and failure predicate')
  ) {
    throw new TypeError('Reproduction artifact evidence metadata is invalid.');
  }
  const parsedTool: ReproductionArtifact['tool'] = {
    name: 'evidrift',
    version: tool.version,
  };
  const parsedEvidence = evidence as unknown as ReproductionArtifact['evidence'];
  if (
    parsedEvidence.minimizedBodyHash !== contentHash(request.body) ||
    parsedEvidence.minimizedBytes !== Buffer.byteLength(canonicalStringify(request.body), 'utf8')
  ) {
    throw new ReproSafetyError('Reproduction artifact minimized-body evidence is inconsistent.');
  }
  if (record.reproId !== artifactId(parsedTool, request, predicate, parsedEvidence)) {
    throw new ReproSafetyError('Reproduction artifact content hash does not match reproId.');
  }
  return {
    schemaVersion: REPRO_ARTIFACT_SCHEMA_VERSION,
    reproId: record.reproId,
    tool: parsedTool,
    request,
    predicate,
    evidence: parsedEvidence,
  };
}

export async function verifyHttpReproduction(
  artifactValue: unknown,
  options: Pick<MinimizeHttpOptions, 'confirmReplay' | 'timeoutMs'>,
): Promise<{ artifact: ReproductionArtifact; observation: ProbeObservation }> {
  const artifact = parseReproductionArtifact(artifactValue);
  const { timeoutMs } = validatedOptions({ ...options, maxProbes: 1 });
  const observation = await observe(
    artifact.request,
    artifact.request.body,
    artifact.predicate,
    timeoutMs,
  );
  return { artifact, observation };
}

async function readJsonInside(repoRoot: string, relativePath: string): Promise<unknown> {
  const canonicalRoot = await realpath(repoRoot);
  const safePath = assertSafeRelativePath(relativePath, 'Reproduction file', false);
  const candidate = resolveInside(canonicalRoot, safePath, 'Reproduction file');
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(candidate);
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new TypeError(`Reproduction input ${safePath} was not found.`);
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new ReproSafetyError('Reproduction input must be a real regular file.');
  }
  const resolved = await realpath(candidate);
  if (!isInside(canonicalRoot, resolved)) {
    throw new ReproSafetyError('Reproduction input resolves outside the repository.');
  }
  const fileMetadata = await stat(resolved);
  if (fileMetadata.size > MAX_FIXTURE_BYTES) {
    throw new RangeError(`Reproduction input exceeds ${MAX_FIXTURE_BYTES} bytes.`);
  }
  const bytes = await readFile(resolved);
  let source: string;
  try {
    source = UTF8_DECODER.decode(bytes);
  } catch {
    throw new TypeError(`Reproduction input ${safePath} is not valid UTF-8.`);
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new TypeError(`Reproduction input ${safePath} is not valid JSON.`);
  }
}

export async function readRequestFixture(
  repoRoot: string,
  relativePath: string,
): Promise<HttpRequestFixture> {
  return parseRequestFixture(await readJsonInside(repoRoot, relativePath));
}

export async function readReproductionArtifact(
  repoRoot: string,
  relativePath: string,
): Promise<ReproductionArtifact> {
  return parseReproductionArtifact(await readJsonInside(repoRoot, relativePath));
}

export async function writeReproductionArtifact(
  repoRoot: string,
  relativePath: string,
  artifact: ReproductionArtifact,
): Promise<string> {
  const canonicalRoot = await realpath(repoRoot);
  const safePath = assertSafeRelativePath(relativePath, 'Reproduction output', false);
  const candidate = resolveInside(canonicalRoot, safePath, 'Reproduction output');
  let parent: string;
  try {
    parent = await realpath(path.dirname(candidate));
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      throw new ReproSafetyError('Reproduction output parent directory does not exist.');
    }
    throw error;
  }
  if (!isInside(canonicalRoot, parent)) {
    throw new ReproSafetyError('Reproduction output parent resolves outside the repository.');
  }
  try {
    await writeFile(candidate, `${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (hasErrorCode(error, 'EEXIST')) {
      throw new ReproSafetyError(
        `Reproduction output ${safePath} already exists; refusing to overwrite it.`,
      );
    }
    throw error;
  }
  return safePath;
}
