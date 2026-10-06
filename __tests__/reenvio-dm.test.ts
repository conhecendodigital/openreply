import { describe, expect, it } from "vitest";
import { saysNotReceived } from "@/lib/queue/dm-worker";

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
