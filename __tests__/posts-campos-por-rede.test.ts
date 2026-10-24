/**
 * 24/10/2026: campos por rede no compositor. Instagram/TikTok/Facebook = legenda + hashtags
 * (no fim da legenda); YouTube = título, descrição e tags (limite total de 500 do YouTube).
 */
import { describe, expect, it } from "vitest";
import {
  cleanHashtag,
  cleanYouTubeTag,
  countHashtags,
  joinCaptionHashtags,
  splitCaptionHashtags,
  splitList,
  youtubeTagsLength,
} from "@/lib/social/text-fields";
import { emptyFacebookForm, emptyYouTubeForm, validateSocialComposer, youTubeFormFromSettings, youTubeSettingsPayload } from "@/lib/social-composer";

describe("hashtags", () => {
  it("limpa o que a pessoa digita", () => {
    expect(cleanHashtag("#Gemini")).toBe("Gemini");
    expect(cleanHashtag("##comandos do gemini")).toBe("comandosdogemini");
    expect(cleanHashtag("#inteligênciaArtificial!")).toBe("inteligênciaArtificial");
    expect(cleanHashtag("#")).toBe("");
  });

  it("separa listas coladas, sem repetir", () => {
    expect(splitList("#ia #Gemini #ia", cleanHashtag)).toEqual(["ia", "Gemini"]);
    expect(splitList("ia, gemini, IA", cleanHashtag)).toEqual(["ia", "gemini"]);
    expect(splitList("comandos do gemini, gemini", cleanYouTubeTag)).toEqual(["comandos do gemini", "gemini"]);
  });

  it("junta no fim da legenda com uma linha em branco e separa de volta ao editar", () => {
    const full = joinCaptionHashtags("Comandos do Gemini  ", ["gemini", "#ia"]);
    expect(full).toBe("Comandos do Gemini\n\n#gemini #ia");
    expect(splitCaptionHashtags(full)).toEqual({ caption: "Comandos do Gemini", hashtags: ["gemini", "ia"] });
    expect(joinCaptionHashtags("", ["ia"])).toBe("#ia");
    expect(joinCaptionHashtags("Só texto", [])).toBe("Só texto");
    // Último parágrafo com texto normal não vira hashtag.
    expect(splitCaptionHashtags("Oi\n\nvale a pena #ia")).toEqual({ caption: "Oi\n\nvale a pena #ia", hashtags: [] });
    expect(countHashtags(full)).toBe(2);
  });
});

describe("tags do YouTube", () => {
  it("tira # e < >, e conta como o YouTube (vírgulas e aspas em tag com espaço)", () => {
    expect(cleanYouTubeTag("#Gemini")).toBe("Gemini");
    expect(cleanYouTubeTag("<b>ia</b>")).toBe("bia/b");
    expect(youtubeTagsLength([])).toBe(0);
    expect(youtubeTagsLength(["ia", "gemini"])).toBe(2 + 6 + 1);
    expect(youtubeTagsLength(["comandos do gemini"])).toBe(18 + 2);
  });

  it("formulário leva descrição e tags; tags vão nas opções, descrição volta do post", () => {
    const form = { ...emptyYouTubeForm(), title: "T", description: "D", tags: ["ia"], madeForKids: false };
    expect(youTubeSettingsPayload(form)).toMatchObject({ title: "T", tags: ["ia"] });
    expect(youTubeSettingsPayload({ ...form, tags: [] })).not.toHaveProperty("tags");
    expect(youTubeFormFromSettings({ title: "T", tags: ["ia", 3] }, "D")).toMatchObject({ title: "T", description: "D", tags: ["ia"] });
  });

  it("compositor barra tags acima de 500 e mais de 30 hashtags no Instagram", () => {
    const base = { accountId: "a", caption: "", mediaUrl: "https://x/v.mp4", mediaBytes: 1000, mediaContentType: "video/mp4", facebook: emptyFacebookForm() };
    const yt = { ...emptyYouTubeForm(), title: "t", madeForKids: false, tags: Array.from({ length: 11 }, (_, i) => `${"a".repeat(48)}${i}`) };
    expect(validateSocialComposer({ ...base, network: "YOUTUBE", youtube: yt }, "draft")).toContain("The tags are too long.");
    const ig = joinCaptionHashtags("x", Array.from({ length: 31 }, (_, i) => `t${i}`));
    expect(validateSocialComposer({ ...base, network: "INSTAGRAM", caption: ig, youtube: emptyYouTubeForm() }, "draft")).toContain("Instagram accepts up to 30 hashtags.");
  });
});
