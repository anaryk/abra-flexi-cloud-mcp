# abra-flexi-mcp

[![CI](https://github.com/OWNER/abra-flexi-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/abra-flexi-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server for the
[ABRA Flexi / FlexiBee REST API](https://www.flexibee.eu/api/). It lets MCP
clients (Claude Desktop, Claude Code, etc.) read and write **any** FlexiBee
agenda (evidence) — invoices, contacts, orders, stock, … — through a single,
generic set of tools.

## Highlights

- **Every agenda, no allow-list.** Tools are generic over the evidence name, so
  any FlexiBee record type is reachable. `flexi_list_evidence_types` discovers
  the full live list.
- **Safe by default writes.** Create / update / delete are gated behind an
  explicit `confirm: true`. Without it the server *previews* the change
  (create/update via FlexiBee `dry-run`, delete by returning the current
  record) and never persists anything.
- **Thoroughly tested.** Unit tests for every layer (mocked HTTP) plus
  integration tests against the public demo `demo.flexibee.eu/c/demo`, with
  write integration tests running exclusively in `dry-run` mode.

## Tools

| Tool | Purpose | Write? |
|------|---------|--------|
| `flexi_list_records` | List records of an evidence (paging, order, detail) | read |
| `flexi_get_record` | Get one record by id or `code:CODE` | read |
| `flexi_query_records` | Filter records with a FlexiBee condition | read |
| `flexi_list_evidence_types` | List all available agendas | read |
| `flexi_create_record` | Create a record (confirm-gated, dry-run preview) | write |
| `flexi_update_record` | Update a record (confirm-gated, dry-run preview) | write |
| `flexi_delete_record` | Delete a record by id (confirm-gated) | write |

### The confirmation flow

```
flexi_create_record { evidence, record }              → dry-run preview, saved:false
flexi_create_record { evidence, record, confirm:true } → actually created, saved:true
```

The same pattern applies to update (dry-run preview) and delete (returns the
record that would be deleted). This guarantees a write only happens after an
explicit, separate confirmation.

## Configuration

All configuration is via environment variables — there are no defaults, the
server fails fast if any required variable is missing.

| Variable | Required | Description |
|----------|----------|-------------|
| `FLEXIBEE_URL` | yes | Base URL, e.g. `https://demo.flexibee.eu` |
| `FLEXIBEE_COMPANY` | yes | Company segment, e.g. `demo` |
| `FLEXIBEE_USER` | yes | HTTP Basic username |
| `FLEXIBEE_PASSWORD` | yes | HTTP Basic password |
| `FLEXIBEE_REJECT_UNAUTHORIZED` | no | Set `false` to skip TLS verification (not recommended) |

See [`.env.example`](./.env.example).

## Usage

### Build

```bash
npm install
npm run build
```

### Run (stdio)

```bash
FLEXIBEE_URL=https://demo.flexibee.eu \
FLEXIBEE_COMPANY=demo \
FLEXIBEE_USER=winstrom \
FLEXIBEE_PASSWORD=winstrom \
node dist/index.js
```

### Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "abra-flexi": {
      "command": "node",
      "args": ["/absolute/path/to/abra-flexi-mcp/dist/index.js"],
      "env": {
        "FLEXIBEE_URL": "https://demo.flexibee.eu",
        "FLEXIBEE_COMPANY": "demo",
        "FLEXIBEE_USER": "winstrom",
        "FLEXIBEE_PASSWORD": "winstrom"
      }
    }
  }
}
```

## Development

```bash
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm test                 # unit tests (mocked HTTP)
npm run test:integration # integration tests against the demo (read + dry-run writes)
npm run test:all         # everything
```

Integration tests target `https://demo.flexibee.eu/c/demo` by default and skip
gracefully if the demo is unreachable. Write integration tests use FlexiBee's
[`dry-run`](https://podpora.flexibee.eu/cs/articles/4720123-testovaci-ulozeni-dry-run)
mode, so they never modify the shared demo.

## How it works

```
src/config.ts      env → validated FlexiBeeConfig (fail-fast)
src/client.ts      thin HTTP: URL building, Basic auth, winstrom envelope, errors
src/operations.ts  generic list/detail/query/create/update/remove/evidenceList
src/tools.ts       MCP tool defs + confirm-gate + annotations
src/server.ts      registers tools on an McpServer
src/index.ts       stdio entry point
```

## License

[MIT](./LICENSE)
