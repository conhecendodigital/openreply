import { describe, expect, it } from "vitest";
import { extractMessageMedia, extractWebhookMedia, mediaLabel } from "../lib/meta/message-media";

describe("extractWebhookMedia", () => {
  it("reads a voice note from the stored webhook message", () => {
    expect(
      extractWebhookMedia({
        mid: "m1",
        attachments: [{ type: "audio", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" } }],
      })
    ).toEqual([{ type: "audio", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1" }]);
  });

  it("ignores messages without attachments", () => {
    expect(extractWebhookMedia({ mid: "m1", text: "oi" })).toEqual([]);
    expect(extractWebhookMedia(null)).toEqual([]);
  });

  it("accepts unknown *_data shapes from the Graph API", () => {
    expect(
      extractMessageMedia({ attachments: { data: [{ voice_data: { url: "https://cdn/v" } } as never] } })
    ).toEqual([{ type: "file", url: "https://cdn/v" }]);
  });
});

describe("extractMessageMedia", () => {
  it("reads photos, videos and audio from Graph API attachments", () => {
    const media = extractMessageMedia({
      attachments: {
        data: [
          { image_data: { url: "https://cdn/img.jpg", preview_url: "https://cdn/img_s.jpg" } },
          { video_data: { url: "https://cdn/v.mp4", preview_url: "https://cdn/v.jpg" } },
          { audio_data: { url: "https://cdn/a.mp4" } },
        ],
      },
    });
    expect(media.map((m) => m.type)).toEqual(["image", "video", "audio"]);
    expect(media[1]).toMatchObject({ url: "https://cdn/v.mp4", previewUrl: "https://cdn/v.jpg" });
  });

  it("uses the mime type for plain files and the webhook shape as fallback", () => {
    expect(
      extractMessageMedia({ attachments: { data: [{ file_url: "https://cdn/f", mime_type: "image/png" }] } })
    ).toEqual([{ type: "image", url: "https://cdn/f" }]);
    expect(
      extractMessageMedia({ attachments: { data: [{ type: "video", payload: { url: "https://cdn/w.mp4" } }] } })
    ).toEqual([{ type: "video", url: "https://cdn/w.mp4" }]);
  });

  it("includes shared posts and story replies", () => {
    const media = extractMessageMedia({
      shares: { data: [{ link: "https://instagram.com/p/x" }] },
      story: { reply_to: { link: "https://cdn/story" } },
    });
    expect(media).toEqual([
      { type: "share", url: "https://instagram.com/p/x" },
      { type: "story", url: "https://cdn/story" },
    ]);
  });

  it("returns nothing for a text-only message", () => {
    expect(extractMessageMedia({})).toEqual([]);
    expect(mediaLabel([])).toBe("");
  });

  it("labels media-only messages for the conversation list", () => {
    expect(mediaLabel([{ type: "image", url: "u" }])).toBe("📷 Photo");
    expect(mediaLabel([{ type: "audio", url: "u" }])).toBe("🎤 Audio");
  });
});
