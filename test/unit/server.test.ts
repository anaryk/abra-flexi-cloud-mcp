import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FlexiBeeClient, type FetchLike, type FetchResponse } from "../../src/client.js";
import { buildServer } from "../../src/server.js";
import type { FlexiBeeConfig } from "../../src/config.js";

const config: FlexiBeeConfig = {
  url: "https://demo.flexibee.eu",
  company: "demo",
  user: "u",
  password: "p",
  rejectUnauthorized: true,
};

const listBody = JSON.stringify({ winstrom: { "faktura-vydana": [{ id: "1", kod: "OVF1" }] } });

function fakeFetch(body: string): { fn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = (url) => {
    calls.push(url);
    const res: FetchResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(body),
    };
    return Promise.resolve(res);
  };
  return { fn, calls };
}

/** Connect an in-memory MCP client to a server backed by the given fetch. */
async function connect(body: string) {
  const { fn, calls } = fakeFetch(body);
  const server = buildServer(new FlexiBeeClient(config, fn));
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, calls };
}

describe("MCP server (protocol smoke test)", () => {
  it("advertises all seven tools over the protocol", async () => {
    const { client } = await connect(listBody);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "flexi_create_record",
        "flexi_delete_record",
        "flexi_get_record",
        "flexi_list_evidence_types",
        "flexi_list_records",
        "flexi_query_records",
        "flexi_update_record",
      ].sort(),
    );
    await client.close();
  });

  it("exposes annotations and an input schema for each tool", async () => {
    const { client } = await connect(listBody);
    const { tools } = await client.listTools();
    const list = tools.find((t) => t.name === "flexi_list_records")!;
    expect(list.annotations?.readOnlyHint).toBe(true);
    expect(list.inputSchema).toBeDefined();
    await client.close();
  });

  it("calls flexi_list_records end-to-end through the protocol", async () => {
    const { client, calls } = await connect(listBody);
    const res = await client.callTool({
      name: "flexi_list_records",
      arguments: { evidence: "faktura-vydana", limit: 1 },
    });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual([{ id: "1", kod: "OVF1" }]);
    expect(calls[0]).toContain("/c/demo/faktura-vydana.json");
    await client.close();
  });

  it("create through the protocol without confirm does not persist", async () => {
    const { client, calls } = await connect(
      JSON.stringify({ winstrom: { success: "true", results: [{ ref: "x" }] } }),
    );
    const res = await client.callTool({
      name: "flexi_create_record",
      arguments: { evidence: "faktura-vydana", record: { kod: "Z1" } },
    });
    const content = res.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text).saved).toBe(false);
    expect(calls[0]).toContain("dry-run=true");
    await client.close();
  });
});
