# Contributing

Thanks for helping keep Evidrift small, deterministic, and honest.

## Setup

```bash
npm ci
npm run verify
```

Node.js 22 or newer is required. Tests must run from a clean clone without secrets, paid APIs, external services, or network access after dependency installation.

## Pull requests

- Keep changes inside the documented v0.2 trust model unless an issue establishes a new scope.
- Add tests for behavior and security boundaries.
- Do not add arbitrary command execution, LLM judgments, or stored verification flags to receipts.
- Update architecture/schema documentation when an invariant changes.
- Run `npm run verify` before opening a pull request.
- Explain any Receipt fixture change; content-addressed IDs must be regenerated intentionally.

## Style

TypeScript is strict, ESLint must produce zero warnings, and Prettier is authoritative. Prefer explicit failure categories over optimistic fallback behavior.

## Reporting security problems

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Releases

Development branches are not npm releases. A formal release must keep `package.json`, `package-lock.json`, `server.json`, the Git tag, the GitHub Release, npm, and the official MCP Registry on the same version.

1. Merge a fully verified version commit to `main`.
2. Run `npm run release:check -- v<version>`.
3. Create the matching annotated tag on that exact `main` commit and push it.
4. Let `.github/workflows/release.yml` verify, publish through npm Trusted Publishing, create the GitHub Release, and publish the MCP Registry entry.
5. Treat the release as incomplete until the workflow reads the same version back from npm and the MCP Registry.

Never publish a development branch directly, reuse an npm version, or move a release tag.
