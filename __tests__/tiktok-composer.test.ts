/**
 * Regras do compositor de posts do TikTok (23/10/2026): privacidade sem padrão,
 * conteúdo de marca sem "Só eu", interação bloqueada pelo TikTok, horário de Brasília.
 */
import { describe, expect, it } from "vitest";
import {
  availablePrivacyOptions,
  brasiliaLocalToIso,
  disclosureKind,
  emptySettings,
  isAllowedVideoType,
  isoToBrasiliaLocal,
  normalizeSettings,
  validateComposer,
  type ComposerInput,
  type CreatorInfo,
} from "@/lib/tiktok-composer";

const info: CreatorInfo = {
  nickname: "Matheus",
  username: "omatheus",
  avatarUrl: null,
  privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxVideoPostDurationSec: 60,
};

function input(over: Partial<ComposerInput> = {}): ComposerInput {
  return {
    accountId: "acc1",
    caption: "Legenda",
    mediaUrl: "https://cdn.exemplo.com/v.mp4",
    mediaContentType: "video/mp4",
    durationSec: 30,
    settings: { ...emptySettings(), privacyLevel: "PUBLIC_TO_EVERYONE" },
    ...over,
  };
}

describe("estado inicial", () => {
  it("começa sem privacidade e com tudo desligado", () => {
    const s = emptySettings();
    expect(s.privacyLevel).toBe("");
    expect(s.allowComment || s.allowDuet || s.allowStitch || s.isAigc).toBe(false);
    expect(s.commercial).toEqual({ enabled: false, yourBrand: false, brandedContent: false });
  });
});

describe("privacidade e conteúdo de marca", () => {
  it("tira Só eu quando é conteúdo de marca", () => {
    expect(availablePrivacyOptions(info.privacyLevelOptions, true)).not.toContain("SELF_ONLY");
    expect(availablePrivacyOptions(info.privacyLevelOptions, false)).toContain("SELF_ONLY");
  });

  it("zera a privacidade Só eu ao ligar conteúdo de marca", () => {
    const s = normalizeSettings(
      {
        ...emptySettings(),
        privacyLevel: "SELF_ONLY",
        commercial: { enabled: true, yourBrand: false, brandedContent: true },
      },
      info
    );
    expect(s.privacyLevel).toBe("");
  });

  it("desliga as caixas de marca quando comercial é desligado", () => {
    const s = normalizeSettings(
      { ...emptySettings(), commercial: { enabled: false, yourBrand: true, brandedContent: true } },
      info
    );
    expect(s.commercial.yourBrand).toBe(false);
    expect(s.commercial.brandedContent).toBe(false);
  });

  it("derruba opção que a conta não oferece", () => {
    const s = normalizeSettings({ ...emptySettings(), privacyLevel: "MUTUAL_FOLLOW_FRIENDS" }, info);
    expect(s.privacyLevel).toBe("");
  });

  it("força off o que o TikTok desabilitou", () => {
    const s = normalizeSettings({ ...emptySettings(), allowDuet: true, allowComment: true }, info);
    expect(s.allowDuet).toBe(false);
    expect(s.allowComment).toBe(true);
  });

  it("escolhe a declaração certa", () => {
    expect(disclosureKind({ enabled: true, yourBrand: false, brandedContent: true })).toBe("branded");
    expect(disclosureKind({ enabled: true, yourBrand: true, brandedContent: false })).toBe("music");
    expect(disclosureKind({ enabled: false, yourBrand: false, brandedContent: false })).toBe("music");
  });
});

describe("horário de Brasília", () => {
  it("converte Brasília para UTC e volta", () => {
    expect(brasiliaLocalToIso("2026-10-24T14:30")).toBe("2026-10-24T17:30:00.000Z");
    expect(isoToBrasiliaLocal("2026-10-24T17:30:00.000Z")).toBe("2026-10-24T14:30");
  });

  it("vira o dia certo perto da meia-noite", () => {
    expect(brasiliaLocalToIso("2026-10-24T23:30")).toBe("2026-10-25T02:30:00.000Z");
    expect(isoToBrasiliaLocal("2026-10-25T02:30:00.000Z")).toBe("2026-10-24T23:30");
  });

  it("recusa texto inválido", () => {
    expect(brasiliaLocalToIso("amanhã")).toBeNull();
    expect(brasiliaLocalToIso("")).toBeNull();
    expect(isoToBrasiliaLocal(null)).toBe("");
    expect(isoToBrasiliaLocal("lixo")).toBe("");
  });
});

describe("validateComposer", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");

  it("rascunho só pede conta, vídeo e legenda dentro do limite", () => {
    expect(validateComposer(input({ settings: emptySettings() }), info, "draft", now)).toEqual([]);
    expect(validateComposer(input({ accountId: "", mediaUrl: "" }), null, "draft", now)).toEqual([
      "Pick the TikTok account.",
      "Add the video.",
    ]);
    expect(validateComposer(input({ caption: "a".repeat(2201) }), info, "draft", now)).toContain(
      "The caption is too long."
    );
  });

  it("publicar exige privacidade escolhida e dados da conta", () => {
    expect(validateComposer(input({ settings: emptySettings() }), info, "publish", now)).toContain(
      "Choose who can see the video."
    );
    expect(validateComposer(input(), null, "publish", now)).toContain(
      "Wait for the account details to load."
    );
    expect(validateComposer(input(), info, "publish", now)).toEqual([]);
  });

  it("recusa privacidade que a conta não oferece", () => {
    const s = { ...emptySettings(), privacyLevel: "MUTUAL_FOLLOW_FRIENDS" };
    expect(validateComposer(input({ settings: s }), info, "publish", now)).toContain(
      "That privacy option is not available for this account."
    );
  });

  it("comercial ligado precisa de uma caixa, e marca não pode ser Só eu", () => {
    const base = { ...emptySettings(), privacyLevel: "PUBLIC_TO_EVERYONE" };
    const semCaixa = { ...base, commercial: { enabled: true, yourBrand: false, brandedContent: false } };
    expect(validateComposer(input({ settings: semCaixa }), info, "publish", now)).toContain(
      "Pick Your brand or Branded content."
    );
    const marcaPrivada = {
      ...base,
      privacyLevel: "SELF_ONLY",
      commercial: { enabled: true, yourBrand: false, brandedContent: true },
    };
    expect(validateComposer(input({ settings: marcaPrivada }), info, "publish", now)).toContain(
      "Branded content can't be private."
    );
  });

  it("recusa vídeo acima da duração máxima, mas aceita o limite exato", () => {
    expect(validateComposer(input({ durationSec: 61 }), info, "publish", now)).toContain(
      "The video is longer than this account allows."
    );
    expect(validateComposer(input({ durationSec: 60 }), info, "publish", now)).toEqual([]);
  });

  it("agendar pede data, no futuro", () => {
    expect(validateComposer(input(), info, "schedule", now)).toContain("Pick the date and time.");
    expect(
      validateComposer(input({ scheduledLocal: "2026-10-23T08:00" }), info, "schedule", now)
    ).toContain("Pick a time in the future.");
    expect(
      validateComposer(input({ scheduledLocal: "2026-10-24T08:00" }), info, "schedule", now)
    ).toEqual([]);
  });
});

describe("tipo de vídeo", () => {
  it("aceita MP4, MOV e WebM", () => {
    expect(isAllowedVideoType("video/mp4")).toBe(true);
    expect(isAllowedVideoType("video/quicktime")).toBe(true);
    expect(isAllowedVideoType("video/webm")).toBe(true);
    expect(isAllowedVideoType("image/png")).toBe(false);
  });
});
