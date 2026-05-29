/**
 * Thin HTTP client for the ABRA Flexi / FlexiBee REST API.
 *
 * Responsibilities only:
 *  - build URLs of the shape /c/{company}/{evidence}[/{id}][/{condition}].json
 *  - attach HTTP Basic auth
 *  - wrap/unwrap the `winstrom` envelope
 *  - parse FlexiBee errors into FlexiBeeError
 *
 * It has no knowledge of MCP.
 */

import type { FlexiBeeConfig } from "./config.js";

/** Minimal fetch signature so tests can inject a fake. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponse>;

export interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export class FlexiBeeError extends Error {
  readonly status: number;
  /** Detailed messages parsed from the FlexiBee error envelope, if any. */
  readonly details: string[];

  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.name = "FlexiBeeError";
    this.status = status;
    this.details = details;
  }
}

export interface ListOptions {
  /** Max number of records. */
  limit?: number;
  /** Offset (zero-based). */
  start?: number;
  /** Detail level, e.g. "summary", "full", or "custom:fld1,fld2". */
  detail?: string;
  /** Sort spec, e.g. "datVyst@D". */
  order?: string;
  /** Validate writes without persisting (FlexiBee dry-run). */
  dryRun?: boolean;
  /** Extra query parameters passed through verbatim. */
  params?: Record<string, string | number | boolean>;
}

/** Build a single-record `winstrom` envelope around an evidence object. */
export function wrapEnvelope(
  evidence: string,
  data: Record<string, unknown> | Array<Record<string, unknown>>,
): string {
  return JSON.stringify({
    winstrom: {
      "@version": "1.0",
      [evidence]: data,
    },
  });
}

/** Extract the records array for an evidence from a `winstrom` response body. */
export function unwrapEnvelope(body: string, evidence: string): unknown {
  const parsed = JSON.parse(body) as { winstrom?: Record<string, unknown> };
  const root = parsed.winstrom;
  if (!root) {
    // Some endpoints (e.g. /evidence-list) may already be unwrapped.
    return parsed;
  }
  if (evidence in root) {
    return root[evidence];
  }
  return root;
}

/** Pull human-readable error strings out of a FlexiBee error response body. */
export function parseErrors(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as {
      winstrom?: { results?: Array<{ errors?: Array<{ message?: string }> }>; message?: string };
    };
    const root = parsed.winstrom;
    if (!root) return [];
    const messages: string[] = [];
    if (root.message) messages.push(root.message);
    for (const result of root.results ?? []) {
      for (const err of result.errors ?? []) {
        if (err.message) messages.push(err.message);
      }
    }
    return messages;
  } catch {
    return [];
  }
}

export class FlexiBeeClient {
  private readonly config: FlexiBeeConfig;
  private readonly fetchFn: FetchLike;

  constructor(config: FlexiBeeConfig, fetchFn?: FetchLike) {
    this.config = config;
    // The global fetch (Node >= 18) satisfies FetchLike structurally.
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.config.user}:${this.config.password}`).toString("base64");
    return `Basic ${token}`;
  }

  /**
   * Build a request URL.
   * @param evidence evidence name, e.g. "faktura-vydana"
   * @param path optional path segment appended after the evidence (id or condition)
   * @param options query options
   */
  buildUrl(evidence: string, path?: string, options: ListOptions = {}): string {
    const base = `${this.config.url}/c/${encodeURIComponent(this.config.company)}/${encodeURIComponent(
      evidence,
    )}`;
    // path may be an id or a "(condition)" segment — appended raw (already encoded by caller where needed).
    const withPath = path ? `${base}/${path}` : base;
    const url = new URL(`${withPath}.json`);

    if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));
    if (options.start !== undefined) url.searchParams.set("start", String(options.start));
    if (options.detail !== undefined) url.searchParams.set("detail", options.detail);
    if (options.order !== undefined) url.searchParams.set("order", options.order);
    if (options.dryRun) url.searchParams.set("dry-run", "true");
    for (const [k, v] of Object.entries(options.params ?? {})) {
      url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private async request(
    method: string,
    url: string,
    body?: string,
  ): Promise<string> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader(),
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchFn(url, { method, headers, body });
    const text = await res.text();
    if (!res.ok) {
      const details = parseErrors(text);
      const detailSuffix = details.length ? `: ${details.join("; ")}` : "";
      throw new FlexiBeeError(
        `FlexiBee request failed (${res.status} ${res.statusText})${detailSuffix}`,
        res.status,
        details,
      );
    }
    return text;
  }

  /** GET list of records for an evidence. Returns the unwrapped records value. */
  async get(evidence: string, path?: string, options: ListOptions = {}): Promise<unknown> {
    const url = this.buildUrl(evidence, path, options);
    const body = await this.request("GET", url);
    return unwrapEnvelope(body, evidence);
  }

  /** PUT (create or update) a record. Returns the unwrapped response (results on success/dry-run). */
  async put(
    evidence: string,
    data: Record<string, unknown>,
    options: ListOptions = {},
  ): Promise<unknown> {
    const url = this.buildUrl(evidence, undefined, options);
    const envelope = wrapEnvelope(evidence, data);
    const body = await this.request("PUT", url, envelope);
    return unwrapEnvelope(body, "winstrom");
  }

  /** DELETE a record by id. */
  async delete(evidence: string, id: string | number): Promise<void> {
    const url = this.buildUrl(evidence, String(id));
    await this.request("DELETE", url);
  }
}
