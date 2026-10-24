import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/media/s3", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readMediaStorageConfig: () => ({ publicBaseUrl: "https://midia.example.com/bucket" }),
}));

import { channelKey, channelsFor, formatFromSettings, pickedChannels, shortProblem, shortSettingsProblem, toggleChannel, withYouTubeFormat } from "@/lib/social/channels";
import { emptyFacebookForm, emptyYouTubeForm, validateSocialComposer } from "@/lib/social-composer";
import { youtubeProvider } from "@/lib/social/providers/youtube";

describe("canais do compositor", () => {
  const accounts = [
    { id: "a1", platform: "YOUTUBE" as const },
    { id: "a2", platform: "INSTAGRAM" as const },
    { id: "a3", platform: "TIKTOK" as const },
  ];

  it("o YouTube vira dois canais (vídeo e Shorts) e as outras redes um só", () => {
    const keys = channelsFor(accounts).map((c) => c.key);
    expect(keys).toEqual(["a1", "a1:short", "a2", "a3"]);
    expect(channelKey("a1", "short")).toBe("a1:short");
  });

  it("marcar e desmarcar; vários canais viram um post cada", () => {
    let picked: string[] = [];
    picked = toggleChannel(picked, "a1:short");
    picked = toggleChannel(picked, "a2");
    picked = toggleChannel(picked, "a1");
    expect(pickedChannels(channelsFor(accounts), picked).map((c) => c.key)).toEqual(["a1", "a1:short", "a2"]);
    expect(toggleChannel(picked, "a2")).not.toContain("a2");
  });
});

describe("regras do YouTube Shorts", () => {
  it("aceita vertical e quadrado até 3 minutos", () => {
    expect(shortProblem({ width: 1080, height: 1920, durationSec: 59 })).toBeNull();
    expect(shortProblem({ width: 1080, height: 1080, durationSec: 180 })).toBeNull();
  });
  it("recusa horizontal e acima de 3 minutos", () => {
    expect(shortProblem({ width: 1920, height: 1080, durationSec: 30 })).toMatch(/vertical or square/);
    expect(shortProblem({ width: 1080, height: 1920, durationSec: 181 })).toMatch(/3 minutes/);
  });
  it("sem dados do vídeo ainda, pede para esperar", () => {
    expect(shortProblem({ width: null, height: null, durationSec: null })).toMatch(/Wait/);
  });
  it("vídeo normal não tem essa regra e guarda o formato", () => {
    expect(withYouTubeFormat({ title: "x" }, "video", { width: 1920, height: 1080, durationSec: 900 })).toEqual({ title: "x", format: "video" });
    expect(formatFromSettings({ format: "short" })).toBe("short");
    expect(formatFromSettings({})).toBe("video");
    expect(shortSettingsProblem({ format: "video" })).toBeNull();
  });
});

describe("servidor confere o Short", () => {
  const settings = { title: "t", privacyStatus: "private", containsSyntheticMedia: false, selfDeclaredMadeForKids: false };
  const post = (s: Record<string, unknown>) => ({
    socialAccount: { status: "ACTIVE", scopes: ["https://www.googleapis.com/auth/youtube.upload"] },
    workspaceId: "ws_A",
    mediaUrl: "https://midia.example.com/bucket/ws_A/posts/v.mp4",
    mediaBytes: 1000,
    mediaContentType: "video/mp4",
    caption: "",
    settings: s,
  });
  it("Short horizontal é barrado; Short vertical e vídeo normal passam", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const check = (s: Record<string, unknown>) => youtubeProvider.readyProblem(post(s) as any, { checkRemote: false });
    expect(await check({ ...settings, format: "short", mediaWidth: 1920, mediaHeight: 1080, mediaSeconds: 30 })).toMatchObject({ code: "invalid_settings" });
    expect(await check({ ...settings, format: "short", mediaWidth: 1080, mediaHeight: 1920, mediaSeconds: 30 })).toBeNull();
    expect(await check({ ...settings, format: "video" })).toBeNull();
  });
});

describe("um vídeo vertical 9:16 para Instagram, TikTok e YouTube Shorts", () => {
  const base = { accountId: "a", mediaUrl: "https://x/v.mp4", mediaBytes: 50 * 1024 * 1024, mediaContentType: "video/mp4", youtube: { ...emptyYouTubeForm(), title: "t", madeForKids: false }, facebook: emptyFacebookForm() };

  it("a validação de cada rede aceita o mesmo MP4 vertical", () => {
    expect(validateSocialComposer({ ...base, network: "INSTAGRAM", caption: "oi" }, "publish")).toEqual([]);
    expect(validateSocialComposer({ ...base, network: "YOUTUBE", caption: "oi" }, "publish")).toEqual([]);
    expect(shortProblem({ width: 1080, height: 1920, durationSec: 45 })).toBeNull();
  });

  it("a legenda é conferida por canal: estoura no Instagram, passa no YouTube", () => {
    const long = "a".repeat(3000);
    expect(validateSocialComposer({ ...base, network: "INSTAGRAM", caption: long }, "draft")).toContain("The caption is too long.");
    expect(validateSocialComposer({ ...base, network: "YOUTUBE", caption: long }, "draft")).toEqual([]);
  });

  it("o canal Shorts grava format short no post", () => {
    const s = withYouTubeFormat({ title: "t" }, "short", { width: 1080, height: 1920, durationSec: 44.2 });
    expect(s).toMatchObject({ format: "short", mediaWidth: 1080, mediaHeight: 1920, mediaSeconds: 45 });
  });
});
