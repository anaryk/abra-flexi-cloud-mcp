import { describe, it, expect, vi } from "vitest";
import {
  FlexiBeeClient,
  FlexiBeeError,
  wrapEnvelope,
  unwrapEnvelope,
  parseErrors,
  type FetchLike,
  type FetchResponse,
} from "../../src/client.js";
import type { FlexiBeeConfig } from "../../src/config.js";

const config: FlexiBeeConfig = {
  url: "https://demo.flexibee.eu",
  company: "demo",
  user: "winstrom",
  password: "secret",
  rejectUnauthorized: true,
};

function response(body: string, status = 200): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    text: () => Promise.resolve(body),
  };
}

/** A fetch fake that records calls and returns a queued response. */
function fakeFetch(body: string, status = 200): { fn: FetchLike; calls: Array<{ url: string; init: unknown }> } {
  const calls: Array<{ url: string; init: unknown }> = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(response(body, status));
  };
  return { fn, calls };
}

describe("wrapEnvelope / unwrapEnvelope", () => {
  it("wraps a record in a winstrom envelope", () => {
    const json = wrapEnvelope("faktura-vydana", { kod: "X1" });
    expect(JSON.parse(json)).toEqual({
      winstrom: { "@version": "1.0", "faktura-vydana": { kod: "X1" } },
    });
  });

  it("unwraps the evidence array from a winstrom response", () => {
    const body = JSON.stringify({
      winstrom: { "@version": "1.0", "faktura-vydana": [{ id: "1" }, { id: "2" }] },
    });
    expect(unwrapEnvelope(body, "faktura-vydana")).toEqual([{ id: "1" }, { id: "2" }]);
  });

  it("returns the winstrom root when the evidence key is absent", () => {
    const body = JSON.stringify({ winstrom: { success: "true", stats: { created: "1" } } });
    expect(unwrapEnvelope(body, "faktura-vydana")).toEqual({ success: "true", stats: { created: "1" } });
  });

  it("returns the whole parsed body when there is no winstrom root", () => {
    const body = JSON.stringify({ evidences: { evidence: [] } });
    expect(unwrapEnvelope(body, "x")).toEqual({ evidences: { evidence: [] } });
  });
});

describe("parseErrors", () => {
  it("extracts error messages from a FlexiBee error envelope", () => {
    const body = JSON.stringify({
      winstrom: {
        success: "false",
        results: [{ errors: [{ message: "Pole 'kod' je povinné" }, { message: "Bad date" }] }],
      },
    });
    expect(parseErrors(body)).toEqual(["Pole 'kod' je povinné", "Bad date"]);
  });

  it("returns an empty array for non-JSON or unrelated bodies", () => {
    expect(parseErrors("<html>500</html>")).toEqual([]);
    expect(parseErrors(JSON.stringify({ other: true }))).toEqual([]);
  });
});

describe("FlexiBeeClient.buildUrl", () => {
  const client = new FlexiBeeClient(config, fakeFetch("{}").fn);

  it("builds a basic list URL", () => {
    expect(client.buildUrl("faktura-vydana")).toBe(
      "https://demo.flexibee.eu/c/demo/faktura-vydana.json",
    );
  });

  it("appends an id path segment", () => {
    expect(client.buildUrl("faktura-vydana", "42")).toBe(
      "https://demo.flexibee.eu/c/demo/faktura-vydana/42.json",
    );
  });

  it("encodes query options including dry-run", () => {
    const url = new URL(
      client.buildUrl("faktura-vydana", undefined, {
        limit: 10,
        start: 5,
        order: "datVyst@D",
        detail: "full",
        dryRun: true,
      }),
    );
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("start")).toBe("5");
    expect(url.searchParams.get("order")).toBe("datVyst@D");
    expect(url.searchParams.get("detail")).toBe("full");
    expect(url.searchParams.get("dry-run")).toBe("true");
  });

  it("does not add dry-run when false", () => {
    const url = new URL(client.buildUrl("faktura-vydana", undefined, { dryRun: false }));
    expect(url.searchParams.has("dry-run")).toBe(false);
  });
});

describe("FlexiBeeClient HTTP behavior", () => {
  it("sends Basic auth and Accept headers on GET", async () => {
    const { fn, calls } = fakeFetch(JSON.stringify({ winstrom: { "faktura-vydana": [] } }));
    const client = new FlexiBeeClient(config, fn);
    await client.get("faktura-vydana");

    const init = calls[0].init as { method: string; headers: Record<string, string> };
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe(
      "Basic " + Buffer.from("winstrom:secret").toString("base64"),
    );
    expect(init.headers.Accept).toBe("application/json");
  });

  it("PUT wraps the body and sets Content-Type", async () => {
    const { fn, calls } = fakeFetch(JSON.stringify({ winstrom: { success: "true" } }));
    const client = new FlexiBeeClient(config, fn);
    await client.put("faktura-vydana", { kod: "X1" }, { dryRun: true });

    const init = calls[0].init as { method: string; headers: Record<string, string>; body: string };
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      winstrom: { "@version": "1.0", "faktura-vydana": { kod: "X1" } },
    });
    expect(calls[0].url).toContain("dry-run=true");
  });

  it("DELETE issues a DELETE to the id URL", async () => {
    const { fn, calls } = fakeFetch("");
    const client = new FlexiBeeClient(config, fn);
    await client.delete("faktura-vydana", 99);
    expect(calls[0].url).toBe("https://demo.flexibee.eu/c/demo/faktura-vydana/99.json");
    expect((calls[0].init as { method: string }).method).toBe("DELETE");
  });

  it("throws FlexiBeeError with parsed details on a non-2xx response", async () => {
    const errorBody = JSON.stringify({
      winstrom: { success: "false", results: [{ errors: [{ message: "Validation failed" }] }] },
    });
    const client = new FlexiBeeClient(config, fakeFetch(errorBody, 400).fn);
    await expect(client.get("faktura-vydana")).rejects.toMatchObject({
      name: "FlexiBeeError",
      status: 400,
      details: ["Validation failed"],
    });
  });

  it("uses the injected fetch, not the global", async () => {
    const spy = vi.fn<FetchLike>(() =>
      Promise.resolve(response(JSON.stringify({ winstrom: { "faktura-vydana": [] } }))),
    );
    const client = new FlexiBeeClient(config, spy);
    await client.get("faktura-vydana");
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("FlexiBeeError", () => {
  it("carries status and details", () => {
    const err = new FlexiBeeError("boom", 500, ["a", "b"]);
    expect(err.status).toBe(500);
    expect(err.details).toEqual(["a", "b"]);
    expect(err).toBeInstanceOf(Error);
  });
});
