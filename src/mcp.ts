#!/usr/bin/env node

import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { recordEvidence, resolveCliProjectRoot } from './core.js';
import { assertSafeRelativePath } from './paths.js';
import { renderRecord } from './output.js';
import { escapeOutputText } from './text.js';
import { EVIDRIFT_VERSION, type AffectedCode } from './types.js';

const LATEST_PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_PROTOCOL_VERSIONS = new Set([LATEST_PROTOCOL_VERSION, '2025-06-18']);
const MAX_MCP_MESSAGE_BYTES = 1024 * 1024;
const MAX_MCP_TOOL_CALLS = 256;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface TypeScriptRecordInput {
  projectRoot: string;
  packageName: string;
  symbol: string;
  parameter?: string;
  overload?: number;
  claim: string;
  affectedCodePath: string;
  affectedCodeLine?: number;
}

interface JsonPointerRecordInput {
  jsonPath: string;
  pointer: string;
  claim: string;
  affectedCodePath: string;
  affectedCodeLine?: number;
}

interface TextToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: true;
}

const TOOL_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const TOOLS = [
  {
    name: 'evidrift_record',
    title: 'Record deterministic TypeScript evidence',
    description:
      'Resolve an actually installed dependency and create a content-addressed Evidrift receipt. When affectedCodeLine points at an overloaded call, TypeScript selects the real call-site signature. The tool records evidence only; it never declares the receipt verified or the code correct.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectRoot: {
          type: 'string',
          default: '.',
          description: 'Repository-relative directory containing the consuming package.json.',
        },
        packageName: {
          type: 'string',
          description: 'Installed npm dependency name.',
        },
        symbol: {
          type: 'string',
          description: 'Exported callable TypeScript symbol.',
        },
        parameter: {
          type: 'string',
          description: 'Optional parameter name that must exist.',
        },
        overload: {
          type: 'integer',
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
          description:
            'Optional 1-based overload selector used only when recording an overloaded symbol.',
        },
        claim: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          description: 'Human claim explaining why this evidence matters.',
        },
        affectedCodePath: {
          type: 'string',
          description: 'Repository-relative source file affected by the claim.',
        },
        affectedCodeLine: {
          type: 'integer',
          minimum: 1,
          description: 'Optional 1-based affected source line.',
        },
      },
      required: ['packageName', 'symbol', 'claim', 'affectedCodePath'],
    },
    annotations: TOOL_ANNOTATIONS,
  },
  {
    name: 'evidrift_record_json_pointer',
    title: 'Record deterministic JSON Pointer evidence',
    description:
      'Read one repository-local JSON file, resolve an RFC 6901 pointer, and create a content-addressed Evidrift receipt. No URL, command, package code, or LLM is invoked.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        jsonPath: {
          type: 'string',
          description: 'Repository-relative `.json` source path.',
        },
        pointer: {
          type: 'string',
          maxLength: 4096,
          description: 'RFC 6901 JSON Pointer. An empty string selects the document root.',
        },
        claim: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          description: 'Human claim explaining why this JSON contract matters.',
        },
        affectedCodePath: {
          type: 'string',
          description: 'Repository-relative source file affected by the claim.',
        },
        affectedCodeLine: {
          type: 'integer',
          minimum: 1,
          description: 'Optional 1-based affected source line.',
        },
      },
      required: ['jsonPath', 'pointer', 'claim', 'affectedCodePath'],
    },
    annotations: TOOL_ANNOTATIONS,
  },
] as const;

function exactObject(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.includes(key));
  if (unknownKey !== undefined) {
    throw new TypeError(`${label} contains unknown field ${JSON.stringify(unknownKey)}.`);
  }
  return record;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  options: { min?: number; max?: number } = {},
): string {
  const value = record[key];
  if (
    typeof value !== 'string' ||
    value.length < (options.min ?? 0) ||
    value.length > (options.max ?? Number.MAX_SAFE_INTEGER)
  ) {
    const range =
      options.min !== undefined || options.max !== undefined
        ? ` with length ${options.min ?? 0}..${options.max ?? Number.MAX_SAFE_INTEGER}`
        : '';
    throw new TypeError(`${key} must be a string${range}.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new TypeError(`${key} must be a string when provided.`);
  }
  return value;
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${key} must be a positive integer when provided.`);
  }
  return value as number;
}

function affectedCode(input: {
  affectedCodePath: string;
  affectedCodeLine?: number;
}): AffectedCode {
  return {
    path: assertSafeRelativePath(input.affectedCodePath, 'Affected code', false),
    ...(input.affectedCodeLine === undefined ? {} : { line: input.affectedCodeLine }),
  };
}

function parseTypeScriptRecordInput(value: unknown): TypeScriptRecordInput {
  const record = exactObject(value, 'evidrift_record arguments', [
    'projectRoot',
    'packageName',
    'symbol',
    'parameter',
    'overload',
    'claim',
    'affectedCodePath',
    'affectedCodeLine',
  ]);
  const parameter = optionalString(record, 'parameter');
  const overload = optionalPositiveInteger(record, 'overload');
  const affectedCodeLine = optionalPositiveInteger(record, 'affectedCodeLine');
  return {
    projectRoot: optionalString(record, 'projectRoot') ?? '.',
    packageName: requiredString(record, 'packageName'),
    symbol: requiredString(record, 'symbol'),
    ...(parameter === undefined ? {} : { parameter }),
    ...(overload === undefined ? {} : { overload }),
    claim: requiredString(record, 'claim', { min: 1, max: 500 }),
    affectedCodePath: requiredString(record, 'affectedCodePath'),
    ...(affectedCodeLine === undefined ? {} : { affectedCodeLine }),
  };
}

function parseJsonPointerRecordInput(value: unknown): JsonPointerRecordInput {
  const record = exactObject(value, 'evidrift_record_json_pointer arguments', [
    'jsonPath',
    'pointer',
    'claim',
    'affectedCodePath',
    'affectedCodeLine',
  ]);
  const affectedCodeLine = optionalPositiveInteger(record, 'affectedCodeLine');
  return {
    jsonPath: requiredString(record, 'jsonPath'),
    pointer: requiredString(record, 'pointer', { max: 4096 }),
    claim: requiredString(record, 'claim', { min: 1, max: 500 }),
    affectedCodePath: requiredString(record, 'affectedCodePath'),
    ...(affectedCodeLine === undefined ? {} : { affectedCodeLine }),
  };
}

function textResult(text: string): TextToolResult {
  return { content: [{ type: 'text', text }] };
}

function toolError(error: unknown): TextToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `Evidrift refused to record evidence: ${escapeOutputText(error instanceof Error ? error.message : String(error))}`,
      },
    ],
    isError: true,
  };
}

async function callTool(
  repoRoot: string,
  name: (typeof TOOLS)[number]['name'],
  argumentsValue: unknown,
): Promise<TextToolResult> {
  try {
    if (name === 'evidrift_record') {
      const input = parseTypeScriptRecordInput(argumentsValue);
      const receipt = await recordEvidence({
        repoRoot,
        projectRoot: resolveCliProjectRoot(repoRoot, input.projectRoot),
        packageName: input.packageName,
        symbol: input.symbol,
        ...(input.parameter === undefined ? {} : { parameter: input.parameter }),
        ...(input.overload === undefined ? {} : { overload: input.overload }),
        claim: input.claim,
        affectedCode: affectedCode(input),
      });
      return textResult(renderRecord(receipt));
    }
    if (name === 'evidrift_record_json_pointer') {
      const input = parseJsonPointerRecordInput(argumentsValue);
      const receipt = await recordEvidence({
        repoRoot,
        jsonPath: assertSafeRelativePath(input.jsonPath, 'JSON source', false),
        pointer: input.pointer,
        claim: input.claim,
        affectedCode: affectedCode(input),
      });
      return textResult(renderRecord(receipt));
    }
    throw new TypeError(`Unsupported Evidrift tool ${JSON.stringify(name)}.`);
  } catch (error) {
    return toolError(error);
  }
}

function requestFrom(value: unknown): JsonRpcRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('JSON-RPC message must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== '2.0' || typeof record.method !== 'string') {
    throw new TypeError('JSON-RPC request must contain jsonrpc "2.0" and a method.');
  }
  if (
    record.id !== undefined &&
    ((typeof record.id !== 'string' && typeof record.id !== 'number') ||
      (typeof record.id === 'number' && !Number.isSafeInteger(record.id)))
  ) {
    throw new TypeError('JSON-RPC request id must be a string or safe integer.');
  }
  return {
    jsonrpc: '2.0',
    ...(record.id === undefined ? {} : { id: record.id as JsonRpcId }),
    method: record.method,
    ...(record.params === undefined ? {} : { params: record.params }),
  };
}

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function writeMessage(output: Writable, message: JsonRpcResponse): Promise<void> {
  const serialized = `${JSON.stringify(message)}\n`;
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      output.off('error', onError);
      reject(error);
    };
    output.once('error', onError);
    output.write(serialized, 'utf8', () => {
      output.off('error', onError);
      resolve();
    });
  });
}

async function* readLines(input: Readable): AsyncGenerator<string> {
  let chunks: Buffer[] = [];
  let bufferedBytes = 0;
  for await (const chunk of input) {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    let offset = 0;
    while (offset < next.byteLength) {
      const newline = next.indexOf(0x0a, offset);
      if (newline < 0) {
        const remainder = next.subarray(offset);
        chunks.push(remainder);
        bufferedBytes += remainder.byteLength;
        if (bufferedBytes > MAX_MCP_MESSAGE_BYTES) {
          throw new RangeError(`MCP message exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`);
        }
        break;
      }
      const piece = next.subarray(offset, newline);
      chunks.push(piece);
      bufferedBytes += piece.byteLength;
      if (bufferedBytes > MAX_MCP_MESSAGE_BYTES) {
        throw new RangeError(`MCP message exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`);
      }
      let lineBuffer =
        chunks.length === 1 ? (chunks[0] as Buffer) : Buffer.concat(chunks, bufferedBytes);
      if (lineBuffer.at(-1) === 0x0d) {
        lineBuffer = lineBuffer.subarray(0, -1);
      }
      let line: string;
      try {
        line = UTF8_DECODER.decode(lineBuffer);
      } catch {
        throw new TypeError('MCP message is not valid UTF-8.');
      }
      yield line;
      chunks = [];
      bufferedBytes = 0;
      offset = newline + 1;
    }
  }
  if (bufferedBytes > 0) {
    throw new TypeError('MCP input ended with an incomplete JSON-RPC message.');
  }
}

export class EvidriftMcpServer {
  readonly #repoRoot: string;
  #initialized = false;
  #toolCalls = 0;

  constructor(repoRoot = process.cwd()) {
    this.#repoRoot = path.resolve(repoRoot);
  }

  async #handle(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined> {
    const id = request.id;
    if (request.method === 'notifications/initialized') {
      return undefined;
    }
    if (request.method.startsWith('notifications/')) {
      return undefined;
    }
    if (id === undefined) {
      return undefined;
    }
    if (request.method === 'initialize') {
      const params = exactObject(request.params, 'initialize params', [
        'protocolVersion',
        'capabilities',
        'clientInfo',
        '_meta',
      ]);
      const requestedVersion = requiredString(params, 'protocolVersion');
      objectValue(params.capabilities, 'initialize capabilities');
      const clientInfo = objectValue(params.clientInfo, 'initialize clientInfo');
      requiredString(clientInfo, 'name', { min: 1 });
      requiredString(clientInfo, 'version', { min: 1 });
      if (params._meta !== undefined) {
        objectValue(params._meta, 'initialize _meta');
      }
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(requestedVersion)
        ? requestedVersion
        : LATEST_PROTOCOL_VERSION;
      this.#initialized = true;
      return success(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'evidrift', version: EVIDRIFT_VERSION },
        instructions:
          'Record deterministic repository evidence only. Evidrift MCP never triggers HTTP replay or declares code correct.',
      });
    }
    if (request.method === 'ping') {
      return success(id, {});
    }
    if (!this.#initialized) {
      return failure(id, -32_002, 'Server not initialized.');
    }
    if (request.method === 'tools/list') {
      if (request.params !== undefined) {
        const params = exactObject(request.params, 'tools/list params', ['cursor', '_meta']);
        if (params.cursor !== undefined) {
          requiredString(params, 'cursor');
        }
        if (params._meta !== undefined) {
          objectValue(params._meta, 'tools/list _meta');
        }
      }
      return success(id, { tools: TOOLS });
    }
    if (request.method === 'tools/call') {
      try {
        const params = exactObject(request.params, 'tools/call params', [
          'name',
          'arguments',
          '_meta',
          'task',
        ]);
        const name = requiredString(params, 'name');
        const tool = TOOLS.find((candidate) => candidate.name === name);
        if (tool === undefined) {
          return failure(id, -32_602, `Tool ${JSON.stringify(name)} was not found.`);
        }
        if (params.task !== undefined) {
          return failure(id, -32_601, 'Evidrift tools do not support task augmentation.');
        }
        if (params._meta !== undefined) {
          objectValue(params._meta, 'tools/call _meta');
        }
        const argumentsValue = params.arguments ?? {};
        objectValue(argumentsValue, 'tools/call arguments');
        this.#toolCalls += 1;
        if (this.#toolCalls > MAX_MCP_TOOL_CALLS) {
          return failure(id, -32_000, `MCP session exceeds ${MAX_MCP_TOOL_CALLS} tool calls.`);
        }
        return success(id, await callTool(this.#repoRoot, tool.name, argumentsValue));
      } catch (error) {
        return failure(
          id,
          -32_602,
          escapeOutputText(error instanceof Error ? error.message : String(error)),
        );
      }
    }
    return failure(id, -32_601, `Method ${JSON.stringify(request.method)} was not found.`);
  }

  async run(input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
    for await (const line of readLines(input)) {
      let request: JsonRpcRequest;
      try {
        request = requestFrom(JSON.parse(line));
      } catch (error) {
        const code = error instanceof SyntaxError ? -32_700 : -32_600;
        await writeMessage(
          output,
          failure(
            null,
            code,
            escapeOutputText(error instanceof Error ? error.message : String(error)),
          ),
        );
        continue;
      }
      try {
        const response = await this.#handle(request);
        if (response !== undefined) {
          await writeMessage(output, response);
        }
      } catch (error) {
        if (request.id !== undefined) {
          await writeMessage(
            output,
            failure(
              request.id,
              -32_602,
              escapeOutputText(error instanceof Error ? error.message : String(error)),
            ),
          );
        }
      }
    }
  }
}

export function createEvidriftMcpServer(repoRoot = process.cwd()): EvidriftMcpServer {
  return new EvidriftMcpServer(repoRoot);
}

export async function runMcpServer(): Promise<void> {
  await createEvidriftMcpServer().run();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runMcpServer().catch((error: unknown) => {
    console.error(
      `Evidrift MCP server failed: ${escapeOutputText(error instanceof Error ? error.message : String(error))}`,
    );
    process.exitCode = 1;
  });
}
