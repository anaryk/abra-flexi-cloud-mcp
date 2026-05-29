/**
 * Generic, evidence-agnostic operations over the FlexiBee REST API.
 *
 * These wrap FlexiBeeClient with a small, predictable surface that the MCP
 * tool layer can call directly. Each function returns plain JSON-serializable
 * values.
 */

import { FlexiBeeClient, type ListOptions } from "./client.js";

export interface ListParams {
  evidence: string;
  limit?: number;
  start?: number;
  detail?: string;
  order?: string;
}

export interface QueryParams extends ListParams {
  /** FlexiBee condition expression, e.g. "kod='OVF001'" or "datVyst gte '2024-01-01'". */
  filter: string;
}

export interface WriteParams {
  evidence: string;
  /** Record fields. */
  record: Record<string, unknown>;
  /** Validate only, do not persist. */
  dryRun?: boolean;
}

function listOptions(p: ListParams): ListOptions {
  return { limit: p.limit, start: p.start, detail: p.detail, order: p.order };
}

/** List records of an evidence. */
export async function list(client: FlexiBeeClient, p: ListParams): Promise<unknown> {
  return client.get(p.evidence, undefined, listOptions(p));
}

/** Get a single record by id or code. */
export async function detail(
  client: FlexiBeeClient,
  evidence: string,
  idOrCode: string | number,
  detailLevel?: string,
): Promise<unknown> {
  return client.get(evidence, String(idOrCode), { detail: detailLevel });
}

/**
 * Query records using a FlexiBee filter condition.
 * The condition is placed in a "(...)" path segment, URL-encoded.
 */
export async function query(client: FlexiBeeClient, p: QueryParams): Promise<unknown> {
  const segment = `(${encodeURIComponent(p.filter)})`;
  return client.get(p.evidence, segment, listOptions(p));
}

/** Create a record. Supports dry-run. */
export async function create(client: FlexiBeeClient, p: WriteParams): Promise<unknown> {
  // FlexiBee uses PUT for both create and update (upsert by id/kod).
  return client.put(p.evidence, p.record, { dryRun: p.dryRun });
}

/** Update an existing record. The record must carry an `id` or `kod`. Supports dry-run. */
export async function update(client: FlexiBeeClient, p: WriteParams): Promise<unknown> {
  if (p.record.id === undefined && p.record.kod === undefined) {
    throw new Error("update requires the record to include an 'id' or 'kod' field");
  }
  return client.put(p.evidence, p.record, { dryRun: p.dryRun });
}

/** Delete a record by id. */
export async function remove(
  client: FlexiBeeClient,
  evidence: string,
  id: string | number,
): Promise<void> {
  return client.delete(evidence, id);
}

/** List available evidence types exposed by the server. */
export async function evidenceList(client: FlexiBeeClient): Promise<unknown> {
  // The /evidence-list endpoint enumerates evidences for the company.
  return client.get("evidence-list");
}
