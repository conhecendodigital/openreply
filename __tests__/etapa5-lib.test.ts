/**
 * Etapa 5 (escala): peças puras. Sorteio A/B determinístico e proporcional,
 * applyVariant sem variante = o mesmo objeto, segmentos viram SQL com tudo
 * parametrizado e o workspace sempre primeiro, a janela de 24 h no SQL igual
 * à do isWindowOpen, opt-out PARAR/SAIR/STOP, CSV com proteção contra
 * fórmula e os dias do relatório no fuso de São Paulo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  variantFindMany: vi.fn(),
  contactUpdateMany: vi.fn(),
  addTag: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    $queryRaw: h.queryRaw,
    campaignVariant: { findMany: h.variantFindMany },
    contact: { updateMany: h.contactUpdateMany },
  },
}));
vi.mock("@/lib/contacts/record", () => ({
  AUTO_TAGS: { optedOut: "saiu:disparos" },
  addTag: h.addTag,
  recordEvent: h.recordEvent,
}));

import { Prisma } from "../app/generated/prisma/client";
import {
  applyVariant,
  broadcastSeed,
  campaignSeed,
  campaignVariantFor,
  pickVariant,
  variantBucket,
  variantData,
} from "../lib/ab/variant";
import { ctr, validateWeights } from "../lib/ab/keys";
import {
  compileSegmentWhere,
  countSegment,
  eligibilitySql,
  eligibleContacts,
  windowOpenSince,
} from "../lib/segments/filters";
import { describeFilters, EMPTY_FILTERS, parseFilters, segmentFiltersSchema } from "../lib/segments/schema";
import { isWindowOpen } from "../lib/messaging/window";
import { isOptOutText, normalizeOptOutText, recordOptOut } from "../lib/broadcasts/optout";
import { csvCell, toCsv } from "../lib/utils/csv-write";
import { dayKeys, localDay, parsePeriod } from "../lib/reports/period";
import { createBroadcastSchema } from "../lib/broadcasts/schema";
import { broadcastPayload, parseBroadcastPayload } from "../lib/broadcasts/jobs";

const NOW = new Date("2026-10-08T15:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("A/B: deterministic draw", () => {
  const ab = [
    { key: "A", weight: 50 },
    { key: "B", weight: 50 },
  ];

  it("the same person always lands on the same variant", () => {
    for (let i = 0; i < 50; i++) {
      const seed = campaignSeed("auto_1", `ig_${i}`);
      const first = pickVariant(seed, ab)?.key;
      for (let j = 0; j < 5; j++) expect(pickVariant(seed, ab)?.key).toBe(first);
      // Order of the rows does not matter.
      expect(pickVariant(seed, [...ab].reverse())?.key).toBe(first);
    }
  });

  it("splits close to the weights (70/30 over 4000 people)", () => {
    const split = [
      { key: "A", weight: 70 },
      { key: "B", weight: 30 },
    ];
    let a = 0;
    for (let i = 0; i < 4000; i++) if (pickVariant(campaignSeed("auto_x", `p${i}`), split)?.key === "A") a += 1;
    expect(a / 4000).toBeGreaterThan(0.66);
    expect(a / 4000).toBeLessThan(0.74);
  });

  it("three variants all get people; weight 0 never wins; nothing to pick = null", () => {
    const three = [
      { key: "A", weight: 34 },
      { key: "B", weight: 33 },
      { key: "C", weight: 33 },
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(pickVariant(broadcastSeed("b_1", `p${i}`), three)!.key);
    expect(seen).toEqual(new Set(["A", "B", "C"]));
    for (let i = 0; i < 100; i++) {
      expect(pickVariant(`s${i}`, [{ key: "A", weight: 0 }, { key: "B", weight: 100 }])?.key).toBe("B");
    }
    expect(pickVariant("x", [])).toBeNull();
    expect(variantBucket("x")).toBe(variantBucket("x"));
    expect(variantBucket("x")).toBeGreaterThanOrEqual(0);
    expect(variantBucket("x")).toBeLessThan(10_000);
  });

  it("seeds are <id>:<igsid> (per campaign / per broadcast)", () => {
    expect(campaignSeed("id", "u")).toBe("id:u");
    expect(broadcastSeed("id", "u")).toBe("id:u");
  });

  it("validates weights: 2-3 variants, A/B/C, whole percents adding up to 100", () => {
    expect(validateWeights([{ key: "A", weight: 50 }, { key: "B", weight: 50 }])).toBeNull();
    expect(validateWeights([{ key: "A", weight: 100 }])).toMatch(/at least 2/);
    expect(validateWeights([{ key: "A", weight: 50 }, { key: "B", weight: 40 }])).toMatch(/100/);
    expect(validateWeights([{ key: "A", weight: 50 }, { key: "A", weight: 50 }])).toMatch(/unique/);
    expect(validateWeights([{ key: "A", weight: 50 }, { key: "D", weight: 50 }])).toMatch(/A, B and C/);
    expect(validateWeights([{ key: "A", weight: 49.5 }, { key: "B", weight: 50.5 }])).toMatch(/whole/);
  });

  it("CTR is capped and safe with zero sends", () => {
    expect(ctr(5, 50)).toBe(10);
    expect(ctr(9, 3)).toBe(100);
    expect(ctr(1, 0)).toBe(0);
  });
});

describe("A/B: off means untouched", () => {
  const automation = { id: "auto_1", dmMessage: "Base", openingDmMessage: "Abre" };

  it("applyVariant(null) returns the very same object", () => {
    expect(applyVariant(automation, null)).toBe(automation);
  });

  it("a variant replaces only the texts it sets", () => {
    const copy = applyVariant(automation, { dmMessage: "B", openingDmMessage: null });
    expect(copy).toEqual({ id: "auto_1", dmMessage: "B", openingDmMessage: "Abre" });
    expect(copy).not.toBe(automation);
    expect(automation.dmMessage).toBe("Base");
    expect(applyVariant(automation, { dmMessage: "  ", openingDmMessage: "X" })).toMatchObject({ dmMessage: "Base", openingDmMessage: "X" });
  });

  it("campaignVariantFor never queries unless abTestEnabled === true", async () => {
    expect(await campaignVariantFor({ id: "a" }, "u")).toBeNull();
    expect(await campaignVariantFor({ id: "a", abTestEnabled: false }, "u")).toBeNull();
    expect(await campaignVariantFor({ id: "a", abTestEnabled: null }, "u")).toBeNull();
    expect(h.variantFindMany).not.toHaveBeenCalled();
    h.variantFindMany.mockResolvedValue([{ key: "A", weight: 100, dmMessage: "x", openingDmMessage: null }]);
    expect(await campaignVariantFor({ id: "a", abTestEnabled: true }, "u")).toMatchObject({ key: "A" });
  });

  it("variantData adds no key without a variant", () => {
    expect(variantData(null)).toEqual({});
    expect(variantData({ key: "B" })).toEqual({ variantKey: "B" });
  });
});

describe("segments: filters to safe SQL", () => {
  const scope = { workspaceId: "ws_A", instagramAccountId: "acc_1" };

  it("empty filters = workspace (+ account) only", () => {
    const sql = compileSegmentWhere(scope, EMPTY_FILTERS, NOW);
    expect(sql.sql).toBe('c."workspaceId" = ? AND c."instagramAccountId" = ?');
    expect(sql.values).toEqual(["ws_A", "acc_1"]);
  });

  it("every value is a bind parameter (an injection attempt stays data)", () => {
    const evil = `x' OR 1=1; DROP TABLE "Contact"; --`;
    const filters = segmentFiltersSchema.parse({
      hasTags: [evil, "clicou"],
      anyTags: ["a"],
      notTags: ["saiu:disparos"],
      commentedCampaignIds: ["auto_1"],
      receivedCampaignIds: ["auto_2"],
      clickedCampaignIds: ["auto_3"],
      clicked: "yes",
      follows: "no",
      lastInteractionDays: 7,
      sources: ["comment", "story", "link"],
    });
    const sql = compileSegmentWhere(scope, filters, NOW);
    expect(sql.sql).not.toContain("DROP");
    expect(sql.sql).not.toContain("auto_1");
    expect(sql.values).toContain(evil);
    expect(sql.values[0]).toBe("ws_A");
    expect(sql.sql.startsWith('c."workspaceId" = ?')).toBe(true);
    // DmLog / LinkClick lookups are pinned to the same workspace.
    expect(sql.sql.match(/d\."workspaceId" = \?/g)).toHaveLength(2);
    expect(sql.sql).toContain('lc."workspaceId" = ?');
    expect(sql.sql).toContain("strpos(d.\"commentId\", ':') = 0");
    expect(sql.sql).toContain('c."followsBusiness" = FALSE');
    expect(sql.sql).toContain('c."clicksCount" > 0');
    expect(sql.values).toContainEqual(new Date(NOW.getTime() - 7 * 86_400_000));
  });

  it("the window in SQL is the same as isWindowOpen (30 min margin)", () => {
    const since = windowOpenSince(NOW);
    const justInside = new Date(since.getTime() + 1000);
    const justOutside = new Date(since.getTime() - 1000);
    expect(isWindowOpen({ lastInboundAt: justInside }, NOW)).toBe(true);
    expect(isWindowOpen({ lastInboundAt: justOutside }, NOW)).toBe(false);
    const e = eligibilitySql(NOW);
    expect(e.windowOpen.sql).toBe('(c."lastInboundAt" IS NOT NULL AND c."lastInboundAt" > ?)');
    expect(e.windowOpen.values).toEqual([since]);
    expect(e.eligible.sql).toContain('NOT (c."broadcastOptOutAt" IS NOT NULL)');
    expect(e.eligible.sql).toContain('"FlowRun"');
    expect(eligibilitySql(NOW, { skipBusy: false }).eligible.sql).not.toContain('"FlowRun"');
  });

  it("busy = flow running, waiting a delay or still waiting the person's reply (not an endless tap wait)", () => {
    const e = eligibilitySql(NOW);
    expect(e.busy.sql).toContain("'ACTIVE', 'WAITING_DELAY'");
    expect(e.busy.sql).toContain(`fr."status" = 'WAITING_REPLY' AND fr."waitingUntil" > ?`);
    expect(e.busy.sql).not.toContain("WAITING_TAP");
    expect(e.busy.values).toEqual([NOW]);
  });

  it("countSegment returns total vs who would receive", async () => {
    h.queryRaw.mockResolvedValue([{ total: 259, windowOpen: 12, optedOut: 3, takeover: 1, busy: 2, eligible: 8 }]);
    const count = await countSegment(scope, EMPTY_FILTERS, { now: NOW });
    expect(count).toEqual({ total: 259, windowOpen: 12, optedOut: 3, takeover: 1, busy: 2, eligible: 8 });
    const sql = h.queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('FROM "Contact" c WHERE c."workspaceId" = ?');
    expect(sql.values).toContainEqual(windowOpenSince(NOW));
  });

  it("eligibleContacts only selects people with the window open (+ not opted out / taken over)", async () => {
    h.queryRaw.mockResolvedValue([{ id: "ct_1", igUserId: "u_1" }]);
    const rows = await eligibleContacts(scope, EMPTY_FILTERS, { now: NOW });
    expect(rows).toEqual([{ id: "ct_1", igUserId: "u_1" }]);
    const sql = h.queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain('c."lastInboundAt" > ?');
    expect(sql.sql).toContain('c."broadcastOptOutAt" IS NOT NULL');
    expect(sql.sql).toContain('c."humanTakeover" = TRUE');
    expect(sql.values).toContainEqual(windowOpenSince(NOW));
    expect(sql.values.at(-1)).toBe(5000);
  });

  it("filters are strict and stored junk falls back to no filter", () => {
    expect(segmentFiltersSchema.safeParse({ hasTags: ["a"], workspaceId: "ws_B" }).success).toBe(false);
    expect(parseFilters({ follows: "maybe" })).toEqual(EMPTY_FILTERS);
    expect(parseFilters(null)).toEqual(EMPTY_FILTERS);
    expect(describeFilters(EMPTY_FILTERS)).toEqual(["todos os contatos"]);
    expect(describeFilters(parseFilters({ hasTags: ["clicou"], follows: "yes" }))).toEqual(["tem todas: clicou", "segue a conta"]);
  });
});

describe("broadcast input", () => {
  const base = { name: "Promo", text: "Oi {first_name}" };

  it("up to 3 buttons (link or flow), unique ids, http(s) only", () => {
    expect(createBroadcastSchema.safeParse({ ...base, buttons: [{ id: "b1", label: "Site", kind: "link", url: "https://x.com" }] }).success).toBe(true);
    expect(createBroadcastSchema.safeParse({ ...base, buttons: [{ id: "b1", label: "Fluxo", kind: "flow", flowId: "f_1" }] }).success).toBe(true);
    expect(createBroadcastSchema.safeParse({ ...base, buttons: [{ id: "b1", label: "x", kind: "link", url: "javascript:alert(1)" }] }).success).toBe(false);
    const four = [1, 2, 3, 4].map((i) => ({ id: `b${i}`, label: "x", kind: "link", url: "https://x.com" }));
    expect(createBroadcastSchema.safeParse({ ...base, buttons: four }).success).toBe(false);
    const dup = [1, 1].map((i) => ({ id: `b${i}`, label: "x", kind: "link", url: "https://x.com" }));
    expect(createBroadcastSchema.safeParse({ ...base, buttons: dup }).success).toBe(false);
    expect(createBroadcastSchema.safeParse({ ...base, text: "x".repeat(641) }).success).toBe(false);
  });

  it("A/B variants add up to 100", () => {
    const ok = [{ key: "A", weight: 60, text: "a" }, { key: "B", weight: 40, text: "b" }];
    expect(createBroadcastSchema.safeParse({ ...base, variants: ok }).success).toBe(true);
    expect(createBroadcastSchema.safeParse({ ...base, variants: [{ key: "A", weight: 60, text: "a" }, { key: "B", weight: 30, text: "b" }] }).success).toBe(false);
    expect(createBroadcastSchema.safeParse({ ...base, variants: [{ key: "A", weight: 60, text: "a" }] }).success).toBe(false);
  });

  it("button payload round-trips and rejects junk", () => {
    expect(parseBroadcastPayload(broadcastPayload("rcp_1", "b1"))).toEqual({ recipientId: "rcp_1", buttonId: "b1" });
    expect(parseBroadcastPayload("bc:rcp_1")).toBeNull();
    expect(parseBroadcastPayload("bc:a:b:c")).toBeNull();
    expect(parseBroadcastPayload("reveal:auto")).toBeNull();
  });
});

describe("opt-out: PARAR / SAIR / STOP", () => {
  it.each(["PARAR", "parar", " Sair! ", "stop.", "SAÍR", "Parar\n"])("%j opts out", (text) => {
    expect(isOptOutText(text)).toBe(true);
  });
  it.each(["parar de fumar", "quero sair daqui", "STOPPED", "", null, "oi"])("%j does not", (text) => {
    expect(isOptOutText(text)).toBe(false);
  });

  it("sets the flag once, tags saiu:disparos and writes OPT_OUT", async () => {
    h.contactUpdateMany.mockResolvedValue({ count: 1 });
    const at = new Date(NOW);
    expect(await recordOptOut({ id: "ct_1", workspaceId: "ws_A" }, { text: "Parar", mid: "mid_1", at })).toBe(true);
    expect(h.contactUpdateMany).toHaveBeenCalledWith({
      where: { id: "ct_1", broadcastOptOutAt: null },
      data: { broadcastOptOutAt: at },
    });
    expect(h.addTag).toHaveBeenCalledWith({ id: "ct_1", workspaceId: "ws_A" }, "saiu:disparos", "auto", at);
    expect(h.recordEvent).toHaveBeenCalledWith(
      { id: "ct_1", workspaceId: "ws_A" },
      expect.objectContaining({ type: "OPT_OUT", refId: "mid_1", text: "PARAR" })
    );
    expect(normalizeOptOutText("  sáir!! ")).toBe("SAIR");
  });

  it("a normal message touches nothing; a DB error never throws", async () => {
    expect(await recordOptOut({ id: "ct_1", workspaceId: "ws_A" }, { text: "oi", mid: "m", at: NOW })).toBe(false);
    expect(h.contactUpdateMany).not.toHaveBeenCalled();
    h.contactUpdateMany.mockRejectedValue(new Error("down"));
    await expect(recordOptOut({ id: "ct_1", workspaceId: "ws_A" }, { text: "STOP", mid: "m", at: NOW })).resolves.toBe(false);
  });
});

describe("CSV export", () => {
  it("escapes quotes, commas and new lines", () => {
    expect(csvCell('diz "oi", tchau')).toBe('"diz ""oi"", tchau"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(-3)).toBe("-3");
  });

  it("neutralises formulas typed by people (= + - @)", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+5511")).toBe("'+5511");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@maria")).toBe("'@maria");
    expect(csvCell("maria")).toBe("maria");
  });

  it("writes rows with a BOM and CRLF", () => {
    expect(toCsv([["a", "b"], [1, "=x"]])).toBe("﻿a,b\r\n1,'=x\r\n");
    expect(toCsv([["a"]], { bom: false })).toBe("a\r\n");
  });
});

describe("report period", () => {
  it("only 7, 30 or 90 days (default 30)", () => {
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("90")).toBe(90);
    expect(parsePeriod("15")).toBe(30);
    expect(parsePeriod(null)).toBe(30);
  });

  it("days are São Paulo days", () => {
    // 02:00 UTC is still the previous day in São Paulo (UTC-3).
    expect(localDay(new Date("2026-10-08T02:00:00Z"))).toBe("2026-10-07");
    expect(localDay(new Date("2026-10-08T04:00:00Z"))).toBe("2026-10-08");
    const keys = dayKeys(new Date(NOW.getTime() - 7 * 86_400_000), NOW);
    expect(keys[0]).toBe("2026-10-01");
    expect(keys.at(-1)).toBe("2026-10-08");
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(8);
  });
});
