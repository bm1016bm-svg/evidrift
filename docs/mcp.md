# MCP setup

Build Evidrift and initialize the target repository first:

```bash
npm ci
npm run build
node /absolute/path/to/evidrift/dist/src/cli.js init --root /absolute/path/to/your/repo
```

Use absolute paths in agent configuration. The server uses its working directory as the repository root and exposes only `evidrift_record`.

## Codex

Official Codex configuration supports `command`, `args`, and `cwd` for STDIO servers. Add this to trusted project `.codex/config.toml` or user `~/.codex/config.toml`:

```toml
[mcp_servers.evidrift]
command = "node"
args = ["/absolute/path/to/evidrift/dist/src/mcp.js"]
cwd = "/absolute/path/to/your/repo"
```

Equivalent CLI command, run from the target repository:

```bash
codex mcp add evidrift -- node /absolute/path/to/evidrift/dist/src/mcp.js
```

Source: [OpenAI Codex configuration reference](https://developers.openai.com/codex/config-reference/).

## Claude Code

Register a project-scoped local STDIO server:

```bash
claude mcp add --scope project evidrift -- node /absolute/path/to/evidrift/dist/src/mcp.js
```

The generated `.mcp.json` has this shape:

```json
{
  "mcpServers": {
    "evidrift": {
      "command": "node",
      "args": ["/absolute/path/to/evidrift/dist/src/mcp.js"],
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
      "command": "node",
      "args": ["/absolute/path/to/evidrift/dist/src/mcp.js"]
    }
  }
}
```

Open the target repository as the Cursor workspace. Source: [Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol).

## Tool contract

`evidrift_record` accepts:

- `projectRoot`: repository-relative consuming project, default `.`.
- `packageName`: installed registry-style npm package name.
- `symbol`: exported callable symbol.
- `parameter`: optional parameter that must exist when recording.
- `claim`: human explanation, maximum 500 characters.
- `affectedCodePath` and optional `affectedCodeLine`.

The tool constructs the Receipt itself. An agent cannot submit raw Receipt JSON, set an ID, store a verification result, or request arbitrary command execution.
