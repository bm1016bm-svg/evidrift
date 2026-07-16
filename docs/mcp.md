# MCP setup

Install Evidrift in the target repository and initialize it first:

```bash
npm install --save-dev evidrift
npx evidrift init
```

The server uses its working directory as the repository root and exposes `evidrift_record` for TypeScript plus `evidrift_record_json_pointer` for repository JSON. The package-level `evidrift mcp` command and the standalone `evidrift-mcp` bin start the same STDIO server.

## Codex

Official Codex configuration supports `command`, `args`, and `cwd` for STDIO servers. Add this to trusted project `.codex/config.toml` or user `~/.codex/config.toml`:

```toml
[mcp_servers.evidrift]
command = "npx"
args = ["--yes", "evidrift", "mcp"]
cwd = "/absolute/path/to/your/repo"
```

Equivalent CLI command, run from the target repository:

```bash
codex mcp add evidrift -- npx --yes evidrift mcp
```

Source: [OpenAI Codex configuration reference](https://developers.openai.com/codex/config-reference/).

## Claude Code

Register a project-scoped local STDIO server:

```bash
claude mcp add --scope project evidrift -- npx --yes evidrift mcp
```

The generated `.mcp.json` has this shape:

```json
{
  "mcpServers": {
    "evidrift": {
      "command": "npx",
      "args": ["--yes", "evidrift", "mcp"],
      "env": {}
    }
  }
}
```

Run the command from the target repository so the server inherits the correct working directory. Source: [Anthropic Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## Cursor

Create `.cursor/mcp.json` in the target repository:

```json
{
  "mcpServers": {
    "evidrift": {
      "command": "npx",
      "args": ["--yes", "evidrift", "mcp"]
    }
  }
}
```

Open the target repository as the Cursor workspace. Source: [Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol).

On Windows, use `npx.cmd` if the MCP client does not resolve PowerShell command shims. For local contributor builds, replace the npm command with `node /absolute/path/to/evidrift/dist/src/mcp.js`.

## Official MCP Registry

`server.json` describes `io.github.bm1016bm-svg/evidrift` as an npm-backed local STDIO server. Its fixed package argument is `mcp`, so registry clients launch `npx evidrift mcp` instead of accidentally entering the human CLI. The Git tag, npm package, server metadata, and registry entry must use the same version.

## TypeScript tool contract

`evidrift_record` accepts:

- `projectRoot`: repository-relative consuming project, default `.`.
- `packageName`: installed registry-style npm package name.
- `symbol`: exported callable symbol.
- `parameter`: optional parameter that must exist when recording.
- `overload`: optional 1-based overload selector used as a fallback when the affected call site cannot be resolved.
- `claim`: human explanation, maximum 500 characters.
- `affectedCodePath` and optional `affectedCodeLine`.

When `affectedCodeLine` points at a call to an overloaded symbol, Evidrift loads the consumer TypeScript configuration and records the declared overload selected by TypeScript. A syntax error, semantic error on the call, wrong location, or multiple different calls on one line is refused rather than guessed. Without a usable call site, the tool returns numbered normalized candidates and the agent can retry with `overload`. The selector index is not trusted during later checks; revalidation searches the current overload set for the content hash saved in the Receipt.

## JSON Pointer tool contract

`evidrift_record_json_pointer` accepts:

- `jsonPath`: repository-relative `.json` source path.
- `pointer`: RFC 6901 JSON Pointer. The empty string selects the document root.
- `claim`: human explanation, maximum 500 characters.
- `affectedCodePath` and optional `affectedCodeLine`.

The tool accepts no URL, project command, raw value, hash, or verification status. It reads the JSON file, resolves the pointer, canonicalizes the selected JSON value, and constructs the Receipt itself. Later checks recompute both the selected value hash and the whole-document source hash. An unrelated document edit warns; a selected value change or removal blocks.

Both tools construct Receipts through the same core. An agent cannot submit raw Receipt JSON, set an ID, store a verification result, fetch a URL, or request arbitrary command execution.
