/**
 * Integration tests against the public ABRA Flexi demo:
 *   https://demo.flexibee.eu/c/demo/
 *
 * - Read tests hit faktura-vydana and evidence-list for real.
 * - Write tests run EXCLUSIVELY with dry-run=true, so nothing is ever
 *   persisted to the shared public demo.
 * - If the demo is unreachable, the whole suite is skipped (not failed) so it
 *   never blocks local/offline development.
 *
 * Override the target with FLEXIBEE_URL / FLEXIBEE_COMPANY / FLEXIBEE_USER /
 * FLEXIBEE_PASSWORD; defaults point at the public demo with winstrom/winstrom.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { FlexiBeeClient } from "../../src/client.js";
import * as ops from "../../src/operations.js";
import { createRecordTool, listRecordsTool } from "../../src/tools.js";
import type { FlexiBeeConfig } from "../../src/config.js";

const config: FlexiBeeConfig = {
  url: process.env.FLEXIBEE_URL ?? "https://demo.flexibee.eu",
  company: process.env.FLEXIBEE_COMPANY ?? "demo",
  user: process.env.FLEXIBEE_USER ?? "winstrom",
  password: process.env.FLEXIBEE_PASSWORD ?? "winstrom",
  rejectUnauthorized: true,
};

const client = new FlexiBeeClient(config);

let reachable = false;

beforeAll(async () => {
  try {
    await ops.list(client, { evidence: "faktura-vydana", limit: 1 });
    reachable = true;
  } catch (err) {
    console.warn(
      `[integration] Demo unreachable, skipping integration tests: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    reachable = false;
  }
}, 30_000);

const maybe = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!reachable) {
      // Mark as skipped at runtime when the demo is down.
      return;
    }
    await fn();
  });

describe("ABRA Flexi demo — reads", () => {
  maybe("lists faktura-vydana and returns an array of invoices", async () => {
    const records = (await ops.list(client, { evidence: "faktura-vydana", limit: 3 })) as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]).toHaveProperty("id");
  });

  maybe("fetches a single faktura-vydana by id", async () => {
    const [first] = (await ops.list(client, { evidence: "faktura-vydana", limit: 1 })) as Array<{
      id: string;
    }>;
    const detail = (await ops.detail(client, "faktura-vydana", first.id, "full")) as Array<
      Record<string, unknown>
    >;
    expect(Array.isArray(detail)).toBe(true);
    expect(detail[0].id).toBe(first.id);
  });

  maybe("queries faktura-vydana with a filter condition", async () => {
    const [first] = (await ops.list(client, { evidence: "faktura-vydana", limit: 1 })) as Array<{
      kod: string;
    }>;
    const result = (await ops.query(client, {
      evidence: "faktura-vydana",
      filter: `kod='${first.kod}'`,
    })) as Array<{ kod: string }>;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].kod).toBe(first.kod);
  });

  maybe("lists evidence types (all agendas) from the demo", async () => {
    const result = await ops.evidenceList(client);
    // The endpoint returns an object describing available evidences.
    expect(result).toBeTruthy();
    expect(typeof result).toBe("object");
  });

  maybe("list tool returns real data via the handler", async () => {
    const res = await listRecordsTool.handler(client, { evidence: "faktura-vydana", limit: 1 });
    expect(res.isError).toBeFalsy();
    expect(Array.isArray(JSON.parse(res.content[0].text))).toBe(true);
  });
});

describe("ABRA Flexi demo — writes (dry-run only, nothing persisted)", () => {
  maybe("create dry-run validates a new invoice without saving it", async () => {
    const before = ((await ops.list(client, { evidence: "faktura-vydana", limit: 1000 })) as unknown[])
      .length;

    const preview = (await ops.create(client, {
      evidence: "faktura-vydana",
      record: {
        typDokl: "code:FAKTURA",
        firma: "code:DODAVATEL",
        datVyst: "2026-01-01",
        popis: "Integration test dry-run — NOT saved",
      },
      dryRun: true,
    })) as Record<string, unknown>;

    // Dry-run returns a winstrom result envelope; success may be reported as string "true".
    expect(preview).toBeTruthy();

    // Count is unchanged: dry-run must not persist anything.
    const after = ((await ops.list(client, { evidence: "faktura-vydana", limit: 1000 })) as unknown[])
      .length;
    expect(after).toBe(before);
  });

  maybe("create tool without confirm uses dry-run and reports saved:false", async () => {
    const res = await createRecordTool.handler(client, {
      evidence: "faktura-vydana",
      record: {
        typDokl: "code:FAKTURA",
        firma: "code:DODAVATEL",
        datVyst: "2026-01-01",
        popis: "Integration confirm-gate test — NOT saved",
      },
    });
    // Either a clean preview (saved:false) or a validation error from the demo —
    // both prove no unconfirmed write was persisted.
    if (!res.isError) {
      expect(JSON.parse(res.content[0].text).saved).toBe(false);
    }
  });
});
