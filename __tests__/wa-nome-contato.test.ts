import { describe, expect, it } from "vitest";
import { blocoNome, nomeDoContato, primeiroESegundoNome } from "@/lib/whatsapp/agentes/nome";
import { preencherPorRegra, type CampoFichaDef } from "@/lib/whatsapp/regras/ficha";
import { montarComando } from "@/lib/whatsapp/agentes/comando";

// Pedido do Matheus (14/10): nome do contato = primeiro e segundo nome; com nome, o agente não pergunta.
describe("nome do contato do WhatsApp", () => {
  it("pega primeiro e segundo nome, sem número, emoji ou título", () => {
    expect(primeiroESegundoNome("Marcelo H2")).toBe("Marcelo");
    expect(primeiroESegundoNome("Fernando Nogueira")).toBe("Fernando Nogueira");
    expect(primeiroESegundoNome("joão PEDRO souza lima 🔨")).toBe("João Pedro");
    expect(primeiroESegundoNome("Maria da Silva Costa")).toBe("Maria da Silva");
    expect(primeiroESegundoNome("Dr. Paulo Henrique")).toBe("Paulo Henrique");
    expect(primeiroESegundoNome("✨ Ana ✨")).toBe("Ana");
  });

  it("não usa empresa, número ou palavra genérica como nome", () => {
    expect(primeiroESegundoNome("Construtora Alfa Ltda")).toBeNull();
    expect(primeiroESegundoNome("Loja Teste")).toBeNull();
    expect(primeiroESegundoNome("+55 11 99999-0000")).toBeNull();
    expect(primeiroESegundoNome("Cliente")).toBeNull();
    expect(primeiroESegundoNome("")).toBeNull();
    expect(primeiroESegundoNome(null)).toBeNull();
  });

  it("nome da agenda vem antes do nome do perfil", () => {
    expect(nomeDoContato({ name: "Joana Prado", pushName: "Jô" })).toBe("Joana Prado");
    expect(nomeDoContato({ name: "123", pushName: "Carlos Mendes" })).toBe("Carlos Mendes");
    expect(nomeDoContato({ name: null, pushName: null })).toBeNull();
  });

  it("o Comando diz o nome e proíbe perguntar; sem nome, não inventa", () => {
    expect(blocoNome("Marcelo")).toContain("NUNCA pergunte o nome");
    expect(blocoNome(null)).toContain("Não invente nome");
    const base = {
      agente: "qualificacao",
      config: {},
      profile: null,
      trechos: [],
      memoria: null,
      historico: [{ id: "m1", fromMe: false, type: "text", body: "Oi", createdAt: new Date() }],
    } as unknown as Parameters<typeof montarComando>[0];
    expect(montarComando({ ...base, nomesDoContato: ["Marcelo H2"] }).sistemaVariavel).toContain("NOME DO CLIENTE (do contato do WhatsApp): Marcelo.");
    expect(montarComando({ ...base, nomesDoContato: [] }).sistemaVariavel).toContain("o contato não tem nome salvo");
  });

  it("a ficha preenche o nome pelo contato mesmo com número no perfil", () => {
    const defs = [{ chave: "nome", rotulo: "Nome", tipo: "nome", palavras: [], pergunta: "" }] as unknown as CampoFichaDef[];
    const out = preencherPorRegra(defs, {
      regras: {} as never,
      historico: [],
      local: { status: "desconhecida" } as never,
      servico: { status: "desconhecido" } as never,
      nomesDoContato: { name: null, pushName: "Marcelo H2" },
      now: new Date("2026-10-14T12:00:00Z"),
    });
    expect(out.nome).toMatchObject({ valor: "Marcelo", origem: "inferido", nota: "nome do perfil do WhatsApp" });
  });
});
