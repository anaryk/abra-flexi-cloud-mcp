import { describe, it, expect } from "vitest";
import { FlexiBeeClient, type FetchLike, type FetchResponse } from "../../src/client.js";
import * as ops from "../../src/operations.js";
import type { FlexiBeeConfig } from "../../src/config.js";

const config: FlexiBeeConfig = {
  url: "https://demo.flexibee.eu",
  company: "demo",
  user: "u",
  password: "p",
  rejectUnauthorized: true,
};

function recorder(body: string): { client: FlexiBeeClient; calls: Array<{ url: string; method: string; body?: string }> } {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    const res: FetchResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(body),
    };
    return Promise.resolve(res);
  };
  return { client: new FlexiBeeClient(config, fn), calls };
}

const listBody = JSON.stringify({ winstrom: { "faktura-vydana": [{ id: "1" }] } });
const writeBody = JSON.stringify({ winstrom: { success: "true", results: [{ id: "5" }] } });

describe("operations", () => {
  it("list builds a list URL with paging and ordering", async () => {
    const { client, calls } = recorder(listBody);
    const result = await ops.list(client, {
      evidence: "faktura-vydana",
      limit: 5,
      start: 10,
      order: "datVyst@D",
      detail: "summary",
    });
    expect(result).toEqual([{ id: "1" }]);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/c/demo/faktura-vydana.json");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("start")).toBe("10");
    expect(url.searchParams.get("order")).toBe("datVyst@D");
    expect(url.searchParams.get("detail")).toBe("summary");
  });

  it("detail fetches by id", async () => {
    const { client, calls } = recorder(listBody);
    await ops.detail(client, "faktura-vydana", 42, "full");
    expect(new URL(calls[0].url).pathname).toBe("/c/demo/faktura-vydana/42.json");
    expect(new URL(calls[0].url).searchParams.get("detail")).toBe("full");
  });

  it("detail accepts a code reference", async () => {
    const { client, calls } = recorder(listBody);
    await ops.detail(client, "faktura-vydana", "code:OVF001");
    expect(new URL(calls[0].url).pathname).toBe("/c/demo/faktura-vydana/code:OVF001.json");
  });

  it("query encodes the filter into a (...) segment", async () => {
    const { client, calls } = recorder(listBody);
    await ops.query(client, { evidence: "faktura-vydana", filter: "kod='OVF001'" });
    // The path contains the URL-encoded condition wrapped in parentheses.
    expect(calls[0].url).toContain("/c/demo/faktura-vydana/(" + encodeURIComponent("kod='OVF001'") + ").json");
  });

  it("create issues a dry-run PUT when dryRun is set", async () => {
    const { client, calls } = recorder(writeBody);
    await ops.create(client, { evidence: "faktura-vydana", record: { kod: "X1" }, dryRun: true });
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("dry-run=true");
    expect(JSON.parse(calls[0].body!)).toEqual({
      winstrom: { "@version": "1.0", "faktura-vydana": { kod: "X1" } },
    });
  });

  it("create issues a real PUT when dryRun is not set", async () => {
    const { client, calls } = recorder(writeBody);
    await ops.create(client, { evidence: "faktura-vydana", record: { kod: "X1" } });
    expect(calls[0].url).not.toContain("dry-run");
  });

  it("update requires id or kod", async () => {
    const { client } = recorder(writeBody);
    await expect(
      ops.update(client, { evidence: "faktura-vydana", record: { popis: "x" } }),
    ).rejects.toThrow(/id.*kod/);
  });

  it("update accepts a record with id", async () => {
    const { client, calls } = recorder(writeBody);
    await ops.update(client, { evidence: "faktura-vydana", record: { id: "7", popis: "x" }, dryRun: true });
    expect(calls[0].method).toBe("PUT");
  });

  it("remove issues a DELETE to the id URL", async () => {
    const { client, calls } = recorder("");
    await ops.remove(client, "faktura-vydana", 9);
    expect(calls[0].method).toBe("DELETE");
    expect(new URL(calls[0].url).pathname).toBe("/c/demo/faktura-vydana/9.json");
  });

  it("evidenceList hits the evidence-list endpoint", async () => {
    const { client, calls } = recorder(JSON.stringify({ evidences: { evidence: [] } }));
    await ops.evidenceList(client);
    expect(new URL(calls[0].url).pathname).toBe("/c/demo/evidence-list.json");
  });
});
