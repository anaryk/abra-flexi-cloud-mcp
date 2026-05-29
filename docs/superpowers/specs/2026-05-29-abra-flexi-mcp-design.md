# ABRA Flexi MCP Server — Design

Date: 2026-05-29

## Goal

A public, open-source MCP (Model Context Protocol) server that exposes the
[ABRA Flexi / FlexiBee REST API](https://www.flexibee.eu/api/) to MCP clients
(Claude, etc.). Generic over any FlexiBee *evidence* (record type), supports
read and write, with thorough unit tests and integration tests against the
public demo at `https://demo.flexibee.eu/c/demo/`.

## Decisions

- **Runtime/language:** TypeScript on Node (`@modelcontextprotocol/sdk`).
- **Scope:** read + write (CRUD).
- **Config:** env-only, no defaults; fail-fast when required vars missing.
- **Entities:** generic tools parameterized by evidence name.
- **Write safety in tests:** write integration tests run **only via FlexiBee's
  `?dry-run=true`** mode, which validates and returns the resulting record
  representation *without persisting it*. Nothing is written to the shared demo.

## FlexiBee REST API facts (confirmed)

- URL shape: `/c/{company}/{evidence}.json`; detail `/c/{company}/{evidence}/{id}.json`.
- Envelope: root key `winstrom` (with `@version`) for both reads and writes.
- Auth: HTTP Basic.
- Write: `PUT` with the `winstrom` envelope body; `DELETE /…/{id}` to delete.
- Query params: `limit`, `start`, `detail`, `order`, filtering via condition
  `(…)` path segment.
- `?dry-run=true`: performs validations only, returns resulting record, no save.

Sources: <https://www.flexibee.eu/api/>,
<https://podpora.flexibee.eu/cs/articles/4720123-testovaci-ulozeni-dry-run>,
<https://demo.flexibee.eu/devdoc/>.

## Architecture (3 layers, independently testable)

1. **`src/config.ts`** — loads & validates env config (`FLEXIBEE_URL`,
   `FLEXIBEE_COMPANY`, `FLEXIBEE_USER`, `FLEXIBEE_PASSWORD`). Fail-fast.
2. **`src/client.ts` (`FlexiBeeClient`)** — thin HTTP wrapper over `fetch`:
   URL building, Basic auth header, winstrom envelope wrap/unwrap, error
   parsing. No MCP knowledge. Unit-tested with a mocked fetch.
3. **`src/operations.ts`** — generic operations over any evidence: `list`,
   `detail`, `query`, `create`, `update`, `remove`, `evidenceList`, each with
   optional `dryRun`. Unit-tested.
4. **`src/server.ts`** — registers MCP tools via the SDK, validates input with
   `zod`. Unit-tested for tool wiring + a protocol smoke test.
5. **`src/index.ts`** — `#!/usr/bin/env node` bin: build config, start stdio
   transport.

## MCP tools (generic over evidence)

- `flexi_list_records` — list (evidence, limit, start, order, detail).
- `flexi_get_record` — detail by id or code.
- `flexi_query_records` — filter by a FlexiBee condition string.
- `flexi_create_record` — create (supports `dryRun`).
- `flexi_update_record` — update (supports `dryRun`).
- `flexi_delete_record` — delete.
- `flexi_list_evidence_types` — list available evidence types.

## Error handling

- HTTP non-2xx → throw `FlexiBeeError` carrying status + FlexiBee error
  messages parsed from the `winstrom` error envelope when present.
- Missing/invalid config → throw at startup with a clear message.
- MCP tool handlers catch errors and return `isError` tool results with text.

## Testing strategy

- **Unit (Vitest, mocked fetch):** config validation, URL building, envelope
  wrap/unwrap, auth header, all operations, error parsing, every MCP tool
  handler, plus a server smoke test over an in-memory transport.
- **Integration (against demo `c/demo`):** real GET list/detail/query on
  `faktura-vydana`; write tests (`create`/`update`) **only with
  `dry-run=true`**. Suite skips gracefully if the demo is unreachable. Run via
  `npm run test:integration`.
- **CI (GitHub Actions):** lint + typecheck + unit on every push/PR;
  integration as a separate, non-blocking job.

## Distribution

Public repo, MIT license, `npx`-runnable bin, `README.md`, `.env.example`,
`.gitignore`.
