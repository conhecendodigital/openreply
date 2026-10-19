import { describe, expect, it } from "vitest";
import { AGORA, cliente, obraBoa } from "./helpers/regras-fixtures";
import { camposDaFicha, fichaVazia, juntarFicha } from "@/lib/whatsapp/regras/ficha";
import { verificarResposta } from "@/lib/whatsapp/regras/verificar";

// Briefing real do Aquele Tapa: "Necessidade" (reforma, construção ou pedras) é campo mínimo.
const regras = obraBoa();
regras.infoMinima = [...regras.infoMinima, { campo: "Necessidade", pergunta: "O que você precisa?", palavras: ["reforma", "construcao", "pedra", "granito"] }];
const defs = camposDaFicha(regras);
const chave = (rotulo: string) => defs.find((d) => d.rotulo === rotulo)!.chave;
const valor = (v: string) => ({ valor: v, msgId: "m1", origem: "confirmado" as const, em: AGORA.toISOString() });

function verificar(bolhas: string[], ditos: Record<string, string>) {
  const campos = Object.fromEntries(Object.entries(ditos).map(([r, v]) => [chave(r), valor(v)]));
  const ficha = juntarFicha(fichaVazia(), campos, AGORA).ficha;
  return verificarResposta({
    regras,
    agente: "qualificacao",
    historico: [cliente("Reforma de apartamento em Paulínia, já peguei as chaves")],
    saida: { bolhas, passarPraHumano: false, qualificado: false, motivo: "", resumoEquipe: "", localObra: null, servico: null, excecao: null, coletado: {} } as never,
    ficha,
    defs,
    nomesDoContato: [],
  });
}
const regrasVioladas = (r: ReturnType<typeof verificar>) => r.violacoes.map((x) => x.regra);
const base = { Necessidade: "reforma", "Local da obra": "Paulínia/SP", "Tipo de imóvel": "apartamento", "Situação das chaves": "já pegou" };

describe("pergunta repetida: citar a palavra do campo não é repetir o campo", () => {
  it("'tem projeto pra reforma?' pergunta o projeto (em aberto), não repete a necessidade", () => {
    expect(regrasVioladas(verificar(["Mariana, tem projeto pra reforma? Se tiver, pode enviar por aqui."], base))).not.toContain("perguntou_de_novo");
  });

  it("perguntar a necessidade de verdade, já respondida, continua acusando", () => {
    expect(regrasVioladas(verificar(["O que você precisa: reforma, construção ou pedras?"], base))).toContain("perguntou_de_novo");
  });

  it("perguntar a cidade já dita continua acusando", () => {
    expect(regrasVioladas(verificar(["Em qual cidade vai ser a obra?"], base))).toContain("perguntou_de_novo");
  });
});
