import { describe, expect, it } from "vitest";
import { isClosingMessage, needsReply } from "@/lib/inbox/needs-reply";

const them = (text: string | null, storyReply = false) => ({ fromMe: false, text, storyReply });
const us = (text: string) => ({ fromMe: true, text, storyReply: false });

describe("isClosingMessage", () => {
  it.each(["Obrigado!", "muito obrigada Matheus 🙏", "recebi", "valeu mano", "Amém", "Deus abençoe", "kkkkkk", "🔥🔥", "❤️", "top demais", "show", "ok", "obrigadooo"])(
    "encerra: %s",
    (t) => expect(isClosingMessage(t)).toBe(true)
  );
  it.each(["sim", "quero", "manda o link", "não recebi", "obrigado, mas como faço?", "quanto custa", "bom dia", "oi", "eu tenho um salão e queria melhorar as fotos", "e aí"])(
    "precisa resposta: %s",
    (t) => expect(isClosingMessage(t)).toBe(false)
  );
});

describe("needsReply", () => {
  it("coração no story ou repost sem texto não precisa", () => {
    expect(needsReply([them(null, true)])).toBe(false);
    expect(needsReply([them("😍", true)])).toBe(false);
  });
  it("se a nossa última perguntou algo, precisa", () => {
    expect(needsReply([us("Opa, tudo bem?"), them(null, true)])).toBe(true);
    expect(needsReply([us("Quer que eu te mande o link?"), them("ok")])).toBe(true);
  });
  it("áudio ou foto sem texto precisa", () => {
    expect(needsReply([them(null)])).toBe(true);
  });
  it("obrigado depois do link não precisa", () => {
    expect(needsReply([them("CHAT"), us("Aqui está o link: https://x"), them("obrigada!")])).toBe(false);
  });
  it("última nossa: não precisa", () => {
    expect(needsReply([them("oi"), us("Oi!")])).toBe(false);
  });
});
