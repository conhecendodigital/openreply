/** Peças puras da aba Posts em várias redes e da grade de Canais: ícones, limites, formulário e cartões. */
import { describe, expect, it } from "vitest";
import { SOCIAL_BRAND_COLOR, SOCIAL_BRAND_NAME, SOCIAL_BRAND_SVG, isSocialBrand } from "../lib/social/brand-icons";
import { NETWORK_LIMITS, UPLOAD_MAX_BYTES, YOUTUBE_TITLE_MAX } from "../lib/social/limits";
import { providerFor } from "../lib/social/providers";
import { SOCIAL_PLATFORMS } from "../lib/social/types";
import {
  acceptForNetwork,
  emptyYouTubeForm,
  facebookSettingsPayload,
  validateSocialComposer,
  youTubeFormFromSettings,
  youTubeSettingsPayload,
  type SocialComposerInput,
} from "../lib/social-composer";
import { TOKEN_WARN_DAYS, buildGrid, countScheduled, gridState, sortGrid, type GridChannel } from "../lib/channels/grid";

const BRANDS = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE", "WHATSAPP"] as const;

describe("ícones das redes", () => {
  it.each(BRANDS)("%s: SVG sem script, sem evento e pintável por currentColor", (brand) => {
    const svg = SOCIAL_BRAND_SVG[brand];
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("currentColor");
    expect(svg).not.toMatch(/<script|<foreignObject|javascript:|\son[a-z]+\s*=|href\s*=\s*["']https?:/i);
    expect(SOCIAL_BRAND_NAME[brand]).toBeTruthy();
    expect(SOCIAL_BRAND_COLOR[brand]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("isSocialBrand só aceita as cinco marcas", () => {
    expect(isSocialBrand("YOUTUBE")).toBe(true);
    expect(isSocialBrand("MYSPACE")).toBe(false);
  });
});

describe("limites por rede", () => {
  it("cada rede tem provider e limite, e o envio aceita o maior arquivo", () => {
    for (const p of SOCIAL_PLATFORMS) {
      expect(providerFor(p).platform).toBe(p);
      expect(NETWORK_LIMITS[p].captionMax).toBeGreaterThan(0);
      expect(NETWORK_LIMITS[p].maxBytes).toBeLessThanOrEqual(UPLOAD_MAX_BYTES);
    }
    expect(NETWORK_LIMITS.INSTAGRAM.captionMax).toBe(2200);
    expect(NETWORK_LIMITS.YOUTUBE.captionMax).toBe(5000);
    expect(YOUTUBE_TITLE_MAX).toBe(100);
  });

  it("Instagram e Facebook não aceitam webm; a tela filtra o seletor por rede", () => {
    expect(acceptForNetwork("INSTAGRAM")).not.toContain("webm");
    expect(acceptForNetwork("YOUTUBE")).toContain("webm");
    expect(acceptForNetwork(null)).toBe(acceptForNetwork("TIKTOK"));
  });
});

describe("formulário do compositor", () => {
  const base: SocialComposerInput = {
    network: "YOUTUBE",
    accountId: "acc_1",
    caption: "descrição",
    mediaUrl: "https://midia.example.com/bucket/a.mp4",
    mediaBytes: 10 * 1024 * 1024,
    mediaContentType: "video/mp4",
    youtube: { ...emptyYouTubeForm(), title: "Oi" },
    facebook: { title: "" },
    scheduledLocal: "2035-01-01T10:00",
  };
  const NOW = new Date("2026-10-23T12:00:00Z");

  it("YouTube começa privado e sem resposta sobre crianças", () => {
    expect(emptyYouTubeForm()).toMatchObject({ privacyStatus: "private", madeForKids: null });
  });

  it("rascunho só confere limites; agendar pede título e a resposta sobre crianças", () => {
    expect(validateSocialComposer({ ...base, youtube: emptyYouTubeForm() }, "draft", NOW)).toEqual([]);
    const errors = validateSocialComposer(base, "schedule", NOW);
    expect(errors).toEqual(["Answer if the video is made for kids."]);
    const ok = { ...base, youtube: { ...base.youtube, madeForKids: false } };
    expect(validateSocialComposer(ok, "schedule", NOW)).toEqual([]);
    expect(validateSocialComposer({ ...ok, scheduledLocal: "2020-01-01T10:00" }, "schedule", NOW)).toEqual(["Pick a time in the future."]);
    expect(validateSocialComposer({ ...ok, scheduledLocal: "" }, "schedule", NOW)).toEqual(["Pick the date and time."]);
  });

  it("limites: título do YouTube, legenda do Instagram, formato e tamanho", () => {
    expect(validateSocialComposer({ ...base, youtube: { ...base.youtube, title: "x".repeat(101) } }, "draft", NOW)).toContain("The title is too long.");
    expect(validateSocialComposer({ ...base, network: "INSTAGRAM", caption: "x".repeat(2201) }, "draft", NOW)).toContain("The caption is too long.");
    expect(validateSocialComposer({ ...base, network: "INSTAGRAM", mediaContentType: "video/webm" }, "draft", NOW).join()).toContain("does not accept this video format");
    expect(validateSocialComposer({ ...base, network: "INSTAGRAM", mediaBytes: 301 * 1024 * 1024 }, "draft", NOW).join()).toContain("larger than Instagram allows");
    expect(validateSocialComposer({ ...base, accountId: "", mediaUrl: "" }, "draft", NOW)).toEqual(["Pick the YouTube account.", "Add the video."]);
  });

  it("converte entre o formulário e as opções gravadas", () => {
    const form = { title: " Meu vídeo ", privacyStatus: "unlisted" as const, madeForKids: false, containsSyntheticMedia: true };
    const payload = youTubeSettingsPayload(form);
    expect(payload).toMatchObject({ title: "Meu vídeo", privacyStatus: "unlisted", selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
    expect(youTubeFormFromSettings(payload)).toMatchObject({ title: "Meu vídeo", privacyStatus: "unlisted", madeForKids: false });
    expect(youTubeFormFromSettings(null)).toEqual(emptyYouTubeForm());
    expect(youTubeFormFromSettings({ privacyStatus: "lixo" }).privacyStatus).toBe("private");
    expect(facebookSettingsPayload({ title: "  Oi " })).toEqual({ title: "Oi" });
  });
});

describe("grade de canais", () => {
  it("o estado do cartão segue a gravidade", () => {
    expect(gridState({ status: "DISCONNECTED" })).toBe("off");
    expect(gridState({ status: "NEEDS_RECONNECT" })).toBe("reconnect");
    expect(gridState({ status: "ACTIVE", serious: true })).toBe("reconnect");
    expect(gridState({ status: "ACTIVE", tokenDays: TOKEN_WARN_DAYS - 1 })).toBe("expiring");
    expect(gridState({ status: "ACTIVE", tokenDays: TOKEN_WARN_DAYS })).toBe("connected");
    expect(gridState({ status: "ACTIVE", warn: true })).toBe("attention");
    expect(gridState({ status: "ACTIVE" })).toBe("connected");
  });

  const instagram = [
    { platform: "facebook" as const, id: "f1", username: "pagina", name: "Minha Página", profilePictureUrl: null, status: "ACTIVE" as const, tokenExpiresInDays: null, webhooksStale: false },
    { platform: "instagram" as const, id: "i1", username: "omatheus.ai", name: "Matheus", profilePictureUrl: "https://x/y.jpg", status: "ACTIVE" as const, tokenExpiresInDays: 5, webhooksStale: false },
  ];
  const social = [
    { id: "y1", source: "social" as const, platform: "YOUTUBE" as const, displayName: "Canal", username: "canal", avatarUrl: null, status: "ACTIVE", missingScopes: ["x"] },
    { id: "t1", source: "social" as const, platform: "TIKTOK" as const, displayName: "Tik", username: null, avatarUrl: null, status: "NEEDS_RECONNECT" },
    // Instagram/Facebook já vêm de "instagram": não podem aparecer duas vezes.
    { id: "i1", source: "channel" as const, platform: "INSTAGRAM" as const, displayName: "dup", username: null, avatarUrl: null, status: "ACTIVE" },
  ];

  it("junta as quatro redes uma vez só, em ordem, com uma linha extra no máximo", () => {
    const grid = buildGrid({ instagram, social, scheduledByAccount: { y1: 3, i1: 2 } });
    expect(grid.map((c) => `${c.network}:${c.id}`)).toEqual(["INSTAGRAM:i1", "FACEBOOK:f1", "TIKTOK:t1", "YOUTUBE:y1"]);
    const byId = Object.fromEntries(grid.map((c) => [c.id, c]));
    expect(byId.i1).toMatchObject({ name: "@omatheus.ai", subtitle: "Matheus", state: "expiring", extra: { kind: "token", days: 5 } });
    expect(byId.f1).toMatchObject({ name: "Minha Página", subtitle: null, extra: null });
    expect(byId.t1).toMatchObject({ state: "reconnect", subtitle: null });
    expect(byId.y1).toMatchObject({ subtitle: "@canal", state: "attention", extra: { kind: "scheduled", count: 3 } });
  });

  it("sortGrid não muda a lista original e ordena por rede e nome", () => {
    const mk = (id: string, network: GridChannel["network"], name: string): GridChannel => ({ id, network, name, subtitle: null, photoUrl: null, status: "ACTIVE", state: "connected", extra: null });
    const input = [mk("a", "YOUTUBE", "b"), mk("b", "INSTAGRAM", "z"), mk("c", "INSTAGRAM", "A")];
    expect(sortGrid(input).map((c) => c.id)).toEqual(["c", "b", "a"]);
    expect(input[0].id).toBe("a");
  });

  it("conta só os agendados de cada conta", () => {
    expect(
      countScheduled([
        { accountId: "a", status: "SCHEDULED" },
        { accountId: "a", status: "SCHEDULED" },
        { accountId: "a", status: "DRAFT" },
        { accountId: "b", status: "PUBLISHED" },
        { accountId: null, status: "SCHEDULED" },
      ])
    ).toEqual({ a: 2 });
  });
});
