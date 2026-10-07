import { describe, expect, it } from "vitest";
import { saysNotReceived, shouldResend } from "@/lib/queue/dm-worker";

// 2026-10-06: DMs reais de quem recebeu o cartão e não viu.
describe("reenvio: 'não recebi' por lista fixa, sem IA", () => {
  it.each([
    "Não tem nenhuma mgs sua aqui!",
    "Não veio 🤭",
    "não veio nada",
    "@omatheus.ai não chegou nada",
    "não recebi",
    "Cadê?",
    "cade o link",
    "não apareceu",
    "nao consigo ver a mensagem",
    "manda de novo por favor",
    "a mensagem veio em branco",
  ])("reconhece %s", (text) => {
    expect(saysNotReceived(text)).toBe(true);
  });

  it.each(["Chegou, obrigada!", "Eu quero", "Chat", "recebi sim, valeu", "quanto custa?", ""])(
    "não confunde %s",
    (text) => {
      expect(saysNotReceived(text)).toBe(false);
    }
  );
});

// 07/10: a Cida respondeu o story ("Ansiosa para acompanhar") e recebeu a automação de novo.
describe("reenvio só quando a pessoa pede de novo", () => {
  const base = { keywords: ["Chat"], fromStory: false, buttonCard: true };
  it.each(["Ansiosa para acompanhar", "😍", "🔥🔥", "Que lindo!", "Amém", "kkkk"])("conversa solta não reenvia: %s", (text) => {
    expect(shouldResend({ ...base, text }).resend).toBe(false);
  });
  it.each(["Chat", "chat!", "me manda o link", "quero", "Eu quero"])("pedido de novo reenvia: %s", (text) => {
    expect(shouldResend({ ...base, text }).resend).toBe(true);
  });
  it("resposta ou reação de story nunca reenvia, a não ser que diga que não recebeu", () => {
    expect(shouldResend({ ...base, fromStory: true, text: "Chat" }).resend).toBe(false);
    expect(shouldResend({ ...base, fromStory: true, text: "😍" }).resend).toBe(false);
    expect(shouldResend({ ...base, fromStory: true, text: "não chegou nada" })).toEqual({ resend: true, said: true });
  });
  it("DM em texto só reenvia quando diz que não recebeu", () => {
    expect(shouldResend({ ...base, buttonCard: false, text: "Chat" }).resend).toBe(false);
    expect(shouldResend({ ...base, buttonCard: false, text: "não veio" }).resend).toBe(true);
  });
});
