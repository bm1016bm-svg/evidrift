#!/usr/bin/env node

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { recordEvidence, resolveCliProjectRoot } from './core.js';
import { assertSafeRelativePath } from './paths.js';
import { renderRecord } from './output.js';
import { escapeOutputText } from './text.js';
import { EVIDRIFT_VERSION } from './types.js';

export function createEvidriftMcpServer(repoRoot = process.cwd()): McpServer {
  const absoluteRepoRoot = path.resolve(repoRoot);
  const server = new McpServer({ name: 'evidrift', version: EVIDRIFT_VERSION });

  server.registerTool(
    'evidrift_record',
    {
      title: 'Record deterministic TypeScript evidence',
      description:
        'Resolve an actually installed dependency and create a content-addressed Evidrift receipt. When affectedCodeLine points at an overloaded call, TypeScript selects the real call-site signature. The tool records evidence only; it never declares the receipt verified or the code correct.',
      inputSchema: z
        .object({
          projectRoot: z
            .string()
            .default('.')
            .describe('Repository-relative directory containing the consuming package.json.'),
          packageName: z.string().describe('Installed npm dependency name.'),
          symbol: z.string().describe('Exported callable TypeScript symbol.'),
          parameter: z.string().optional().describe('Optional parameter name that must exist.'),
          overload: z
            .number()
            .int()
            .positive()
            .max(Number.MAX_SAFE_INTEGER)
            .optional()
            .describe(
              'Optional 1-based overload selector used only when recording an overloaded symbol.',
            ),
          claim: z
            .string()
            .min(1)
            .max(500)
            .describe('Human claim explaining why this evidence matters.'),
          affectedCodePath: z
            .string()
            .describe('Repository-relative source file affected by the claim.'),
          affectedCodeLine: z.number().int().positive().optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const receipt = await recordEvidence({
          repoRoot: absoluteRepoRoot,
          projectRoot: resolveCliProjectRoot(absoluteRepoRoot, input.projectRoot),
          packageName: input.packageName,
          symbol: input.symbol,
          ...(input.parameter === undefined ? {} : { parameter: input.parameter }),
          ...(input.overload === undefined ? {} : { overload: input.overload }),
          claim: input.claim,
          affectedCode: {
            path: assertSafeRelativePath(input.affectedCodePath, 'Affected code', false),
            ...(input.affectedCodeLine === undefined ? {} : { line: input.affectedCodeLine }),
          },
        });
        return {
          content: [{ type: 'text' as const, text: renderRecord(receipt) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Evidrift refused to record evidence: ${escapeOutputText(error instanceof Error ? error.message : String(error))}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'evidrift_record_json_pointer',
    {
      title: 'Record deterministic JSON Pointer evidence',
      description:
        'Read one repository-local JSON file, resolve an RFC 6901 pointer, and create a content-addressed Evidrift receipt. No URL, command, package code, or LLM is invoked.',
      inputSchema: z
        .object({
          jsonPath: z.string().describe('Repository-relative `.json` source path.'),
          pointer: z
            .string()
            .max(4096)
            .describe('RFC 6901 JSON Pointer. An empty string selects the document root.'),
          claim: z
            .string()
            .min(1)
            .max(500)
            .describe('Human claim explaining why this JSON contract matters.'),
          affectedCodePath: z
            .string()
            .describe('Repository-relative source file affected by the claim.'),
          affectedCodeLine: z.number().int().positive().optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const receipt = await recordEvidence({
          repoRoot: absoluteRepoRoot,
          jsonPath: assertSafeRelativePath(input.jsonPath, 'JSON source', false),
          pointer: input.pointer,
          claim: input.claim,
          affectedCode: {
            path: assertSafeRelativePath(input.affectedCodePath, 'Affected code', false),
            ...(input.affectedCodeLine === undefined ? {} : { line: input.affectedCodeLine }),
          },
        });
        return { content: [{ type: 'text' as const, text: renderRecord(receipt) }] };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Evidrift refused to record evidence: ${escapeOutputText(error instanceof Error ? error.message : String(error))}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createEvidriftMcpServer();
  await server.connect(new StdioServerTransport());
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
