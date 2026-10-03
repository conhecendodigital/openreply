/**
 * Etapa 2: links de conversa (ig.me?ref=). Os 3 formatos da doc oficial,
 * SHORTLINK e SHORTLINKS, e a validação do código.
 */
import { describe, expect, it } from "vitest";
import { parseReferralEvents, referralEventKey } from "../lib/conversation-links/referral";
import { buildClickUrl, buildIgMeUrl, defaultTagFor, isValidCode, normalizeOrigin } from "../lib/conversation-links/links";

const payload = (messaging: unknown[]) => ({ object: "instagram", entry: [{ id: "ig_owner", time: 1, messaging }] });
const base = { sender: { id: "ig_person" }, recipient: { id: "ig_owner" }, timestamp: 1_700_000_000_000 };

describe("parseReferralEvents", () => {
  it("existing thread: referral at the top (messaging_referral)", () => {
    const events = parseReferralEvents(
      payload([{ ...base, referral: { ref: "story_out", source: "SHORTLINKS", type: "OPEN_THREAD" } }])
    );
    expect(events).toEqual([
      {
        instagramAccountId: "ig_owner",
        igUserId: "ig_person",
        ref: "story_out",
        kind: "referral",
        source: "SHORTLINKS",
        timestamp: base.timestamp,
      },
    ]);
    expect(referralEventKey(events[0])).toBe(`ref:${base.timestamp}`);
  });

  it("new thread + Ice Breaker tap: postback.referral", () => {
    const [event] = parseReferralEvents(
      payload([
        {
          ...base,
          postback: { mid: "pb_1", title: "Quero", payload: "ICE_1", referral: { ref: "bio", source: "SHORTLINK", type: "OPEN_THREAD" } },
        },
      ])
    );
    expect(event).toMatchObject({ kind: "postback", ref: "bio", mid: "pb_1", source: "SHORTLINK" });
    expect(referralEventKey(event)).toBe("pb_1");
  });

  it("new thread + typed message: message.referral", () => {
    const [event] = parseReferralEvents(
      payload([{ ...base, message: { mid: "m_1", text: "oi", referral: { ref: "pagina", source: "shortlinks", type: "OPEN_THREAD" } } }])
    );
    expect(event).toMatchObject({ kind: "message", ref: "pagina", mid: "m_1" });
  });

  it("ignores ads, echoes, missing refs and other objects", () => {
    expect(parseReferralEvents(payload([{ ...base, referral: { ref: "x", source: "ADS", ad_id: "1" } }]))).toEqual([]);
    expect(
      parseReferralEvents(
        payload([{ ...base, message: { mid: "e", is_echo: true, referral: { ref: "x", source: "SHORTLINKS" } } }])
      )
    ).toEqual([]);
    expect(parseReferralEvents(payload([{ ...base, referral: { source: "SHORTLINKS" } }]))).toEqual([]);
    expect(parseReferralEvents({ object: "page", entry: [] })).toEqual([]);
    expect(parseReferralEvents(payload([{ ...base, message: { mid: "m", text: "oi" } }]))).toEqual([]);
  });

  it("our own account is never a referral", () => {
    expect(
      parseReferralEvents(payload([{ ...base, sender: { id: "ig_owner" }, referral: { ref: "x", source: "SHORTLINKS" } }]))
    ).toEqual([]);
  });
});

describe("conversation link helpers", () => {
  it("builds the ig.me and counted URLs", () => {
    expect(buildIgMeUrl("@omatheus.ai", "story_1")).toBe("https://ig.me/m/omatheus.ai?ref=story_1");
    expect(buildClickUrl("https://le.example/", "story_1")).toBe("https://le.example/c/story_1");
  });

  it("accepts only Meta's ref charset", () => {
    expect(isValidCode("story-1_A=")).toBe(true);
    expect(isValidCode("veio:story")).toBe(false);
    expect(isValidCode("com espaço")).toBe(false);
    expect(isValidCode("")).toBe(false);
    expect(isValidCode("a".repeat(65))).toBe(false);
  });

  it("normalizes the origin into the default tag", () => {
    expect(normalizeOrigin("Página")).toBe("pagina");
    expect(defaultTagFor("Story")).toBe("veio:story");
  });
});
