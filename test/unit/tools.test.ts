import { describe, it, expect } from "vitest";
import { FlexiBeeClient, FlexiBeeError, type FetchLike, type FetchResponse } from "../../src/client.js";
import {
  allTools,
  listRecordsTool,
  getRecordTool,
  queryRecordsTool,
  createRecordTool,
  updateRecordTool,
  deleteRecordTool,
  listEvidenceTypesTool,
} from "../../src/tools.js";
import type { FlexiBeeConfig } from "../../src/config.js";

const config: FlexiBeeConfig = {
  url: "https://demo.flexibee.eu",
  company: "demo",
  user: "u",
  password: "p",
  rejectUnauthorized: true,
};

interface Call {
  url: string;
  method: string;
  body?: string;
}

/** Build a client whose fetch returns `body`/`status`, recording every call. */
function harness(body: string, status = 200): { client: FlexiBeeClient; calls: Call[] } {
  const calls: Call[] = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    const res: FetchResponse = {
      ok: status >= 200 && status < 300,
      status,
      statusText: "S",
      text: () => Promise.resolve(body),
    };
    return Promise.resolve(res);
  };
  return { client: new FlexiBeeClient(config, fn), calls };
}

const listBody = JSON.stringify({ winstrom: { "faktura-vydana": [{ id: "1", kod: "OVF1" }] } });
const dryRunBody = JSON.stringify({ winstrom: { success: "true", results: [{ ref: "preview" }] } });

describe("tool registry", () => {
  it("exposes exactly the seven expected tools with unique names", () => {
    const names = allTools.map((t) => t.name);
    expect(names).toEqual([
      "flexi_list_records",
      "flexi_get_record",
      "flexi_query_records",
      "flexi_list_evidence_types",
      "flexi_create_record",
      "flexi_update_record",
      "flexi_delete_record",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks read tools readOnly and write tools not readOnly", () => {
    expect(listRecordsTool.annotations.readOnlyHint).toBe(true);
    expect(getRecordTool.annotations.readOnlyHint).toBe(true);
    expect(queryRecordsTool.annotations.readOnlyHint).toBe(true);
    expect(listEvidenceTypesTool.annotations.readOnlyHint).toBe(true);
    expect(createRecordTool.annotations.readOnlyHint).toBe(false);
    expect(deleteRecordTool.annotations.destructiveHint).toBe(true);
    expect(updateRecordTool.annotations.destructiveHint).toBe(true);
  });
});

describe("read tool handlers", () => {
  it("flexi_list_records returns the records as pretty JSON text", async () => {
    const { client } = harness(listBody);
    const res = await listRecordsTool.handler(client, { evidence: "faktura-vydana", limit: 1 });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toEqual([{ id: "1", kod: "OVF1" }]);
  });

  it("flexi_get_record fetches by id", async () => {
    const { client, calls } = harness(listBody);
    await getRecordTool.handler(client, { evidence: "faktura-vydana", idOrCode: "1" });
    expect(new URL(calls[0].url).pathname).toBe("/c/demo/faktura-vydana/1.json");
  });

  it("flexi_query_records passes the filter", async () => {
    const { client, calls } = harness(listBody);
    await queryRecordsTool.handler(client, { evidence: "faktura-vydana", filter: "kod='OVF1'" });
    expect(calls[0].url).toContain(encodeURIComponent("kod='OVF1'"));
  });

  it("returns an isError result when the API fails", async () => {
    const errBody = JSON.stringify({
      winstrom: { results: [{ errors: [{ message: "nope" }] }] },
    });
    const { client } = harness(errBody, 500);
    const res = await listRecordsTool.handler(client, { evidence: "faktura-vydana" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("nope");
    expect(res.content[0].text).toContain("500");
  });
});

describe("write tools are confirm-gated", () => {
  it("create without confirm performs a dry-run and does NOT persist", async () => {
    const { client, calls } = harness(dryRunBody);
    const res = await createRecordTool.handler(client, {
      evidence: "faktura-vydana",
      record: { kod: "NEW1" },
    });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse(res.content[0].text);
    expect(payload.saved).toBe(false);
    expect(payload.status).toBe("preview");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].url).toContain("dry-run=true");
  });

  it("create with confirm performs a real PUT", async () => {
    const { client, calls } = harness(dryRunBody);
    const res = await createRecordTool.handler(client, {
      evidence: "faktura-vydana",
      record: { kod: "NEW1" },
      confirm: true,
    });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.saved).toBe(true);
    expect(payload.status).toBe("created");
    expect(calls[0].url).not.toContain("dry-run");
  });

  it("update without confirm previews via dry-run", async () => {
    const { client, calls } = harness(dryRunBody);
    const res = await updateRecordTool.handler(client, {
      evidence: "faktura-vydana",
      record: { id: "1", popis: "edited" },
    });
    expect(JSON.parse(res.content[0].text).saved).toBe(false);
    expect(calls[0].url).toContain("dry-run=true");
  });

  it("update with confirm persists", async () => {
    const { client, calls } = harness(dryRunBody);
    const res = await updateRecordTool.handler(client, {
      evidence: "faktura-vydana",
      record: { id: "1", popis: "edited" },
      confirm: true,
    });
    expect(JSON.parse(res.content[0].text).status).toBe("updated");
    expect(calls[0].url).not.toContain("dry-run");
  });

  it("delete without confirm fetches the record and does NOT delete", async () => {
    const { client, calls } = harness(listBody);
    const res = await deleteRecordTool.handler(client, { evidence: "faktura-vydana", id: "1" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.deleted).toBe(false);
    expect(payload.status).toBe("preview");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
  });

  it("delete with confirm issues a DELETE", async () => {
    const { client, calls } = harness("");
    const res = await deleteRecordTool.handler(client, {
      evidence: "faktura-vydana",
      id: "1",
      confirm: true,
    });
    expect(JSON.parse(res.content[0].text).deleted).toBe(true);
    expect(calls[0].method).toBe("DELETE");
  });

  it("delete preview tolerates a missing record (record: null)", async () => {
    const { client } = harness(
      JSON.stringify({ winstrom: { results: [{ errors: [{ message: "not found" }] }] } }),
      404,
    );
    const res = await deleteRecordTool.handler(client, { evidence: "faktura-vydana", id: "999" });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.deleted).toBe(false);
    expect(payload.record).toBeNull();
  });
});

describe("FlexiBeeError formatting", () => {
  it("includes details in the error text", () => {
    const err = new FlexiBeeError("x", 400, ["d1", "d2"]);
    expect(err.details).toEqual(["d1", "d2"]);
  });
});
