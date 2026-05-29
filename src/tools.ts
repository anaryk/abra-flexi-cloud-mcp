/**
 * MCP tool definitions for the ABRA Flexi server.
 *
 * Each tool is defined as a pure object: a name, description, MCP annotations,
 * a zod input shape, and a handler that takes (client, validatedArgs) and
 * returns an MCP tool result. Keeping handlers free of the SDK makes them
 * trivially unit testable; `server.ts` only wires them into an McpServer.
 *
 * The server is generic over evidence: any FlexiBee agenda (record type) is
 * reachable by passing its name — there is no per-agenda allow-list.
 *
 * Write safety: create/update/delete are gated behind an explicit `confirm`
 * flag. Without `confirm: true` the server does NOT persist anything. Instead
 * it returns a preview (create/update use FlexiBee dry-run; delete returns the
 * current record) and asks the caller to re-issue the call with confirm: true.
 */

import { z } from "zod";
import { FlexiBeeClient, FlexiBeeError } from "./client.js";
import * as ops from "./operations.js";

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  description: string;
  annotations: ToolAnnotations;
  inputShape: Shape;
  handler: (client: FlexiBeeClient, args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>;
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** A non-error result that nonetheless represents "awaiting confirmation". */
function notice(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  let text: string;
  if (error instanceof FlexiBeeError) {
    text = `FlexiBee error ${error.status}: ${error.message}`;
    if (error.details.length) text += `\nDetails:\n- ${error.details.join("\n- ")}`;
  } else if (error instanceof Error) {
    text = error.message;
  } else {
    text = String(error);
  }
  return { content: [{ type: "text", text }], isError: true };
}

/** Wrap a handler body so thrown errors become isError tool results. */
function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  return fn().catch(fail);
}

const evidence = z.string().min(1).describe('Evidence (agenda) name, e.g. "faktura-vydana", "adresar".');
const confirm = z
  .boolean()
  .optional()
  .describe(
    "Must be true to actually persist the change. When omitted/false, the server only " +
      "previews the operation (no data is written) and asks you to confirm.",
  );

function defineTool<Shape extends z.ZodRawShape>(def: ToolDefinition<Shape>): ToolDefinition<Shape> {
  return def;
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

export const listRecordsTool = defineTool({
  name: "flexi_list_records",
  description:
    "List records of any FlexiBee evidence (agenda). Supports paging (limit/start), " +
    "sorting (order) and detail level.",
  annotations: { title: "List records", readOnlyHint: true },
  inputShape: {
    evidence,
    limit: z.number().int().positive().optional().describe("Max records to return."),
    start: z.number().int().nonnegative().optional().describe("Zero-based offset."),
    order: z.string().optional().describe('Sort spec, e.g. "datVyst@D" (D=descending).'),
    detail: z
      .string()
      .optional()
      .describe('Detail level: "summary", "full", or "custom:field1,field2".'),
  },
  handler: (client, args) => guard(async () => ok(await ops.list(client, args))),
});

export const getRecordTool = defineTool({
  name: "flexi_get_record",
  description: "Get a single FlexiBee record by its numeric id or code reference (code:CODE).",
  annotations: { title: "Get record", readOnlyHint: true },
  inputShape: {
    evidence,
    idOrCode: z.string().min(1).describe('Numeric id or code reference, e.g. "123" or "code:OVF001".'),
    detail: z.string().optional().describe('Detail level: "summary", "full", or "custom:...".'),
  },
  handler: (client, args) =>
    guard(async () => ok(await ops.detail(client, args.evidence, args.idOrCode, args.detail))),
});

export const queryRecordsTool = defineTool({
  name: "flexi_query_records",
  description:
    "Query FlexiBee records with a filter condition. The filter uses FlexiBee syntax, " +
    "e.g. \"kod='OVF001'\" or \"datVyst gte '2024-01-01' and sumCelkem gt 1000\".",
  annotations: { title: "Query records", readOnlyHint: true },
  inputShape: {
    evidence,
    filter: z.string().min(1).describe("FlexiBee filter condition expression."),
    limit: z.number().int().positive().optional(),
    start: z.number().int().nonnegative().optional(),
    order: z.string().optional(),
    detail: z.string().optional(),
  },
  handler: (client, args) => guard(async () => ok(await ops.query(client, args))),
});

export const listEvidenceTypesTool = defineTool({
  name: "flexi_list_evidence_types",
  description:
    "List ALL evidence types (agendas) available on this FlexiBee server. Use this to " +
    "discover which agenda names can be passed to the other tools.",
  annotations: { title: "List evidence types", readOnlyHint: true },
  inputShape: {},
  handler: (client) => guard(async () => ok(await ops.evidenceList(client))),
});

// ---------------------------------------------------------------------------
// Write tools (confirm-gated)
// ---------------------------------------------------------------------------

export const createRecordTool = defineTool({
  name: "flexi_create_record",
  description:
    "Create a record in any FlexiBee evidence. SAFETY: without confirm:true this only " +
    "validates via dry-run and returns a preview WITHOUT saving. Re-issue with confirm:true to persist.",
  annotations: { title: "Create record", readOnlyHint: false, destructiveHint: false },
  inputShape: {
    evidence,
    record: z.record(z.unknown()).describe("Record fields as a JSON object."),
    confirm,
  },
  handler: (client, args) =>
    guard(async () => {
      if (!args.confirm) {
        const preview = await ops.create(client, {
          evidence: args.evidence,
          record: args.record,
          dryRun: true,
        });
        return notice({
          status: "preview",
          saved: false,
          message:
            "Dry-run only — nothing was created. Review the preview and call flexi_create_record " +
            "again with confirm: true to actually create this record.",
          preview,
        });
      }
      const result = await ops.create(client, { evidence: args.evidence, record: args.record });
      return ok({ status: "created", saved: true, result });
    }),
});

export const updateRecordTool = defineTool({
  name: "flexi_update_record",
  description:
    "Update an existing FlexiBee record (must include 'id' or 'kod'). SAFETY: without " +
    "confirm:true this only validates via dry-run and returns a preview WITHOUT saving. " +
    "Re-issue with confirm:true to persist.",
  annotations: { title: "Update record", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  inputShape: {
    evidence,
    record: z
      .record(z.unknown())
      .describe("Record fields as a JSON object; must include 'id' or 'kod'."),
    confirm,
  },
  handler: (client, args) =>
    guard(async () => {
      if (!args.confirm) {
        const preview = await ops.update(client, {
          evidence: args.evidence,
          record: args.record,
          dryRun: true,
        });
        return notice({
          status: "preview",
          saved: false,
          message:
            "Dry-run only — nothing was changed. Review the preview and call flexi_update_record " +
            "again with confirm: true to actually apply this change.",
          preview,
        });
      }
      const result = await ops.update(client, { evidence: args.evidence, record: args.record });
      return ok({ status: "updated", saved: true, result });
    }),
});

export const deleteRecordTool = defineTool({
  name: "flexi_delete_record",
  description:
    "Delete a FlexiBee record by numeric id. SAFETY: without confirm:true this only fetches " +
    "and returns the record that WOULD be deleted, without deleting it. Re-issue with " +
    "confirm:true to actually delete. Deletion is irreversible.",
  annotations: { title: "Delete record", readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  inputShape: {
    evidence,
    id: z.string().min(1).describe("Numeric id of the record to delete."),
    confirm,
  },
  handler: (client, args) =>
    guard(async () => {
      if (!args.confirm) {
        const record = await ops.detail(client, args.evidence, args.id).catch(() => null);
        return notice({
          status: "preview",
          deleted: false,
          message:
            `About to delete ${args.evidence} id=${args.id}. This is irreversible. ` +
            "Call flexi_delete_record again with confirm: true to actually delete it.",
          record,
        });
      }
      await ops.remove(client, args.evidence, args.id);
      return ok({ status: "deleted", deleted: true, evidence: args.evidence, id: args.id });
    }),
});

/** All tools in registration order. */
export const allTools = [
  listRecordsTool,
  getRecordTool,
  queryRecordsTool,
  listEvidenceTypesTool,
  createRecordTool,
  updateRecordTool,
  deleteRecordTool,
] as const;
