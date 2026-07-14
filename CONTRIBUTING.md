# Contributing

Thanks for helping keep Litmo small, deterministic, and honest.

## Setup

```bash
npm ci
npm run verify
```

Node.js 22 or newer is required. Tests must run from a clean clone without secrets, paid APIs, external services, or network access after dependency installation.

## Pull requests

- Keep changes inside the documented v0.1 trust model unless an issue establishes a new scope.
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
