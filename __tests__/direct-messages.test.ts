import { describe, expect, it } from "vitest";
import { parseDirectMessages } from "../lib/messages/parse";

const ACC = "17841458325510640";

function payload(messaging: unknown[]) {
  return { object: "instagram", entry: [{ id: ACC, time: 1759434550, messaging }] };
}

describe("parseDirectMessages", () => {
  it("keeps an inbound voice note (the shape Meta sent on 2026-10-02)", () => {
    const [m] = parseDirectMessages(payload([{
      sender: { id: "999" }, recipient: { id: ACC }, timestamp: 1759438148000,
      message: { mid: "mid-audio", attachments: [{ type: "audio", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" } }] },
    }]));
    expect(m).toMatchObject({ accountId: ACC, contactId: "999", fromMe: false, mid: "mid-audio", text: null });
    expect(m.media).toEqual([{ type: "audio", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1", download: true }]);
    expect(m.sentAt.toISOString()).toBe("2025-10-02T20:49:08.000Z");
  });

  it("stores our own campaign DM (echo) with its buttons", () => {
    const [m] = parseDirectMessages(payload([{
      sender: { id: ACC }, recipient: { id: "555" }, timestamp: 1759434550000,
      message: { mid: "mid-tpl", is_echo: true, attachments: [{ type: "template", payload: { generic: { elements: [
        { title: "Opa, tudo bem?", buttons: [{ type: "web_url", title: "Arrumar minha foto", url: "https://many.leadenginer.com/r/x" }] },
      ] } } }] },
    }]));
    expect(m).toMatchObject({ fromMe: true, contactId: "555" });
    expect(m.template).toEqual({ title: "Opa, tudo bem?", subtitle: undefined, buttons: [{ title: "Arrumar minha foto", url: "https://many.leadenginer.com/r/x" }] });
    expect(m.media).toEqual([]);
  });

  it("flags story replies and keeps the story media", () => {
    const [m] = parseDirectMessages(payload([{
      sender: { id: "777" }, recipient: { id: ACC }, timestamp: 1,
      message: { mid: "mid-story", text: "que lindo", reply_to: { story: { url: "https://lookaside.fbsbx.com/s", id: "s1" } } },
    }]));
    expect(m.storyReply).toBe(true);
    expect(m.text).toBe("que lindo");
    expect(m.media[0]).toMatchObject({ type: "story", download: true });
  });

  it("keeps shared posts as links (not downloaded)", () => {
    const [m] = parseDirectMessages(payload([{
      sender: { id: "777" }, recipient: { id: ACC }, timestamp: 1,
      message: { mid: "mid-share", attachments: [{ type: "share", payload: { url: "https://www.instagram.com/p/abc/" } }] },
    }]));
    expect(m.media).toEqual([{ type: "share", url: "https://www.instagram.com/p/abc/", download: false }]);
  });

  it("ignores reads, postbacks and other objects", () => {
    expect(parseDirectMessages(payload([{ sender: { id: "1" }, recipient: { id: ACC }, read: { mid: "x" } }]))).toEqual([]);
    expect(parseDirectMessages({ object: "page", entry: [] })).toEqual([]);
    expect(parseDirectMessages(null)).toEqual([]);
  });
});
