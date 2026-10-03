import { describe, expect, it } from "vitest";
import { pt } from "../lib/i18n/pt";
import { DRAFT_STATUS_LABELS, messagingErrorText } from "../components/messaging-ui";
import { encodeQr, qrSvgPath } from "../lib/qr";

describe("Etapa 2 screens", () => {
  it("translates every draft status and error message shown indirectly", () => {
    const shown = [
      ...Object.values(DRAFT_STATUS_LABELS),
      ...["window_closed", "takeover", "pending_exists", "not_pending", "maybe_sent", "missing_scope", undefined].map((c) =>
        messagingErrorText(c)
      ),
    ];
    expect(shown.filter((s) => !(s in pt))).toEqual([]);
  });

  it("builds QR matrices of the right size for short and long links", () => {
    // 39 bytes fit version 3 at level M (29x29).
    expect(encodeQr("https://ig.me/m/omatheus.ai?ref=s7Kq2xP").length).toBe(29);
    expect(encodeQr("a").length).toBe(21);
    const long = encodeQr("https://ig.me/m/" + "x".repeat(200));
    expect(long.length).toBeGreaterThan(45);
    expect(long.every((row) => row.length === long.length)).toBe(true);
    // Finder pattern corner is dark, separator is light.
    expect(long[0][0]).toBe(true);
    expect(long[7][7]).toBe(false);
    const { size, path } = qrSvgPath(encodeQr("a"));
    expect(size).toBe(29);
    expect(path.startsWith("M")).toBe(true);
  });
});
