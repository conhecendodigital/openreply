import { describe, expect, it } from "vitest";
import { blocoFicha } from "@/lib/whatsapp/regras/prompt";
import type { CampoFichaDef, FichaLead } from "@/lib/whatsapp/regras/ficha";

const defs: CampoFichaDef[] = [
  { chave: "nome", rotulo: "Nome", tipo: "nome", palavras: [], pergunta: "Nome?", obrigatorio: true },
  { chave: "cidade", rotulo: "Cidade da obra", tipo: "cidade", palavras: [], pergunta: "Em qual cidade será a obra?", obrigatorio: true },
  { chave: "chaves", rotulo: "Situação das chaves", tipo: "outro", palavras: [], pergunta: "Já pegou as chaves?", obrigatorio: true },
];
const campo = (valor: string) => ({ valor, msgId: "m1", origem: "confirmado" as const, em: "2026-10-19T12:00:00Z" });
const ficha = (campos: FichaLead["campos"]): FichaLead => ({ campos, atualizadoEm: null });

describe("blocoFicha: próxima pergunta já decidida", () => {
  it("sem cidade: a cidade vem primeiro, mesmo com o nome antes na lista, e proíbe confirmar atendimento", () => {
    const { falta } = blocoFicha(ficha({}), defs);
    expect(falta).toContain("PERGUNTE AGORA, e só isso (uma pergunta, na última bolha): Cidade da obra");
    expect(falta).toContain("Depois, uma por vez, nessa ordem: Nome; Situação das chaves");
    expect(falta).toContain("O LOCAL DA OBRA AINDA É DESCONHECIDO");
    expect(falta).not.toContain("JÁ RESPONDIDO");
  });

  it("com cidade e tipo já ditos: lista o que não repetir e pergunta só o próximo", () => {
    const { falta, sabe } = blocoFicha(ficha({ cidade: campo("Campinas/SP") }), defs);
    expect(sabe).toContain("Cidade da obra: Campinas/SP");
    expect(falta).toContain("PERGUNTE AGORA, e só isso (uma pergunta, na última bolha): Nome");
    expect(falta).toContain("JÁ RESPONDIDO, nunca pergunte de novo (nem com outras palavras): Cidade da obra");
    expect(falta).not.toContain("O LOCAL DA OBRA AINDA É DESCONHECIDO");
  });

  it("tudo respondido: mantém a frase antiga", () => {
    const { falta } = blocoFicha(ficha({ nome: campo("Ana"), cidade: campo("Campinas/SP"), chaves: campo("sim") }), defs);
    expect(falta).toBe("O QUE AINDA FALTA PERGUNTAR: nada das informações mínimas. Não repita perguntas.");
  });

  it("sem campo de cidade nas regras: não inventa regra de local", () => {
    const { falta } = blocoFicha(ficha({}), defs.filter((d) => d.tipo !== "cidade"));
    expect(falta).not.toContain("LOCAL DA OBRA");
    expect(falta).toContain("PERGUNTE AGORA, e só isso (uma pergunta, na última bolha): Nome");
  });
});
