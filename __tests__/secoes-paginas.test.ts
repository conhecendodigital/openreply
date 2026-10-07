// @vitest-environment happy-dom
/**
 * Seções recolhíveis nas páginas (06/10/2026): WhatsApp > Agentes com o
 * índice e cada seção, regras em grupos com resumo e chips, "Confira antes de
 * salvar" com o resumo por grupo e o link que abre o grupo, Canais e
 * Configurações. Dados fictícios, fetch trocado por respostas prontas.
 */
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import { regrasVazias, type RegrasNegocio } from "../lib/whatsapp/regras/esquema";
import { SectionsProvider } from "../components/ui/collapsible-section";
import { ReviewPanel } from "../components/whatsapp/treinar";
import { RulesPanel, rulesToText } from "../components/whatsapp/regras";
import type { CampoTreino, RascunhoTreino } from "../lib/whatsapp/treinar/esquema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  // Deixa os fetch falsos responderem.
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

const btn = (id: string) => document.getElementById(`${id}-botao`) as HTMLButtonElement | null;
const isOpen = (id: string) => btn(id)?.getAttribute("aria-expanded") === "true";

function regras(): RegrasNegocio {
  return {
    ...regrasVazias(),
    cidadesAtendidas: [
      { cidade: "Paulínia", uf: "SP" },
      { cidade: "Campinas", uf: "SP" },
    ],
    cidadesNaoAtendidas: [{ cidade: "Hortolândia", uf: "SP" }],
    servicosAceitos: ["Reforma de cozinha", "Pintura", "Telhado", "Piso"],
    casosTeste: [{ situacao: "Cliente de Hortolândia quer orçamento", decisao: "Fora da área", motivo: "", esperado: ["fora_da_area"] }],
    responsavel: { nome: "Carla", telefone: "" },
  } as RegrasNegocio;
}

const VIEW = {
  sessions: [{ id: "s1", label: "+5516900001111", status: "CONNECTED" }],
  sessionId: "s1",
  numberMode: "DRAFT",
  profile: {
    baseCommand: "Somos a Casa Firme Reformas, em Paulínia.",
    quietStart: "22:00",
    quietEnd: "08:00",
    maxAutoPerDay: 100,
    delayMinSeconds: 5,
    delayMaxSeconds: 30,
    facts: ["Visita técnica custa R$ 0"],
    debounceSeconds: 8,
  },
  agents: [
    { agente: "qualificacao", ativo: true, instrucoes: "Pergunte o bairro antes do preço." },
    { agente: "atendimento", ativo: false, instrucoes: "" },
    { agente: "suporte", ativo: false, instrucoes: "" },
  ],
  rules: regras(),
  stages: {},
  notifyOwner: { ligado: false, telefone: "" },
};

const LEARNING = { examples: [], blocked: { total: 0, corrected: 0, byRule: [], recent: [] }, discarded: { total: 0, recent: [] }, outside: [], suggestions: [] };

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      // Cliente do better-auth (sessões abertas): lista vazia.
      if (url.includes("/list-sessions")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/get-session")) return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const body = key ? { success: true, data: routes[key] } : { success: false, error: "not mocked" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("WhatsApp > Agentes em seções", () => {
  it("mostra o índice e todas as seções, com o que é usado sempre aberto e o raro fechado", async () => {
    mockFetch({
      "/api/whatsapp/status": { enabled: true, gatewayConfigured: true, uazapiConfigured: true, webhookReady: true, ai: { anthropic: true, openai: true } },
      "/api/whatsapp/agents/aprendizado": LEARNING,
      "/api/whatsapp/agents": VIEW,
      "/api/whatsapp/cerebro/": { documents: [] },
    });
    const { default: Page } = await import("../app/(dashboard)/whatsapp/agents/page");
    await render(h(Page));

    for (const id of ["numero", "treinar", "sobre", "regras", "agente-qualificacao", "agente-atendimento", "agente-suporte", "estagios", "ritmo", "testar", "aprendeu"]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    const chips = Array.from(document.querySelectorAll("[data-secao-indice] nav a")).map((a) => a.textContent);
    expect(chips).toContain("Agentes neste número");
    expect(chips).toContain("Treinar com um documento");
    expect(chips).toContain("Regras do negócio");
    expect(chips).toContain("O que o agente aprendeu");
    expect(document.body.textContent).toContain("Abrir tudo");

    // Usado sempre: aberto. Configuração rara: fechado com resumo.
    expect(isOpen("numero")).toBe(true);
    expect(isOpen("sobre")).toBe(true);
    expect(isOpen("agente-qualificacao")).toBe(true); // ligado
    expect(isOpen("agente-suporte")).toBe(false); // desligado
    expect(isOpen("treinar")).toBe(false); // já tem Comando base
    expect(isOpen("ritmo")).toBe(false);
    expect(document.getElementById("ritmo")!.textContent).toContain("Espera de 5 a 30 s · Silêncio de 22:00 a 08:00 · Até 100 por dia");

    // Regras em grupos fechados com resumo de uma linha.
    expect(isOpen("regras-onde")).toBe(false);
    expect(document.getElementById("regras-onde")!.textContent).toContain("2 cidades atendidas · 1 fora · 0 com cuidado · 0 exceções");
    expect(document.getElementById("regras-servicos")!.textContent).toContain("4 serviços aceitos");
    expect(document.getElementById("regras-quem")!.textContent).toContain("Responsável: Carla");

    // Cidades como chips editáveis.
    const onde = document.getElementById("regras-onde")!;
    expect(onde.querySelector('button[aria-label="Tirar Paulínia/SP"]')).not.toBeNull();
    expect(document.getElementById("regra-cidadesAtendidas")).not.toBeNull();

    // Ids e rótulos antigos continuam lá (campos montados mesmo fechados).
    expect(document.querySelector('input[aria-label="Ligar Qualificação"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Comando base");
  });
});

function draft(): RascunhoTreino {
  return {
    arquivo: { nome: "briefing.docx", tipo: "docx", caracteres: 1000, cortado: false },
    profile: { baseCommand: "x", facts: [], quietStart: null, quietEnd: null, delayMinSeconds: null, delayMaxSeconds: null, maxAutoPerDay: null },
    agents: { qualificacao: "", atendimento: "", suporte: "" },
    doDocumento: ["rules"],
    mensagensAprovadas: [{ tipo: "boas_vindas", quando: "primeira mensagem", texto: "Oi! Aqui é da Casa Firme.", literal: true }],
    casosDeTeste: [],
    regras: regras(),
    revisar: {
      pendencias: [{ assunto: "Atende sábado?", trecho: "" }, { assunto: "Valor da visita", trecho: "" }],
      soInstrucao: [],
      contradicoes: [],
      naoAchei: [{ campo: "facts", valor: "R$ 0" }],
      avisos: [],
    },
  };
}

describe("Confira antes de salvar", () => {
  it("vira resumo no topo com contagem por grupo, pendências em destaque e link que abre o grupo", async () => {
    const rules = regras();
    await render(
      h(
        SectionsProvider,
        { page: "teste-conferir" },
        h(ReviewPanel, {
          draft: draft(),
          saved: false,
          onClose: () => undefined,
          links: [{ id: "regras-onde", title: "Onde atende", summary: "2 cidades atendidas · 1 fora" }],
        }),
        h(RulesPanel, { text: rulesToText(rules), onText: () => undefined, rules, onRules: () => undefined, fromDoc: new Set<CampoTreino>() })
      )
    );
    expect(isOpen("conferir")).toBe(true);
    const resumo = document.querySelector("[data-resumo-conferir]")!;
    expect(resumo.textContent).toContain("Pendências (A definir)2");
    expect(resumo.textContent).toContain("Não achei no documento1");
    expect(resumo.textContent).toContain("Onde atende");
    // Com pendência abre sozinho; vazio fica fechado.
    expect(isOpen("conferir-pendencias")).toBe(true);
    expect(isOpen("conferir-nao-achei")).toBe(true);
    expect(isOpen("conferir-contradicoes")).toBe(false);
    expect(btn("conferir")!.textContent).toContain("3 pra conferir");

    // Fecha as regras e clica no link do resumo: abre o grupo e o cartão em volta.
    await act(async () => btn("regras")!.click());
    expect(isOpen("regras")).toBe(false);
    const link = Array.from(resumo.querySelectorAll("a")).find((a) => a.getAttribute("href") === "#regras-onde")!;
    await act(async () => (link as HTMLElement).click());
    expect(isOpen("regras-onde")).toBe(true);
    expect(isOpen("regras")).toBe(true);
  });
});

describe("Canais e Configurações em seções", () => {
  it("Canais: Instagram, Em breve e Conexões e chaves com os serviços como grupos", async () => {
    mockFetch({
      "/api/channels/integrations": {
        whatsappEnabled: true,
        audit: [],
        ai: null,
        services: [
          {
            service: "uazapi",
            source: "workspace",
            workspaceComplete: true,
            envConfigured: false,
            fields: [
              { field: "serverUrl", kind: "url", saved: true, last4: ".com", number: null, updatedAt: null, updatedBy: null },
              { field: "adminToken", kind: "secret", saved: true, last4: "x9Zk", number: null, updatedAt: null, updatedBy: null },
            ],
          },
        ],
      },
      "/api/channels": { instagram: [], comingSoon: [{ platform: "tiktok", name: "TikTok", requirements: [] }] },
      "/api/workspace/members": { currentUserRole: "OWNER", members: [], invitations: [] },
      "/api/workspace/meta-capi": { pixelId: null, tokenSaved: false },
    });
    const { default: Page } = await import("../app/(dashboard)/channels/page");
    await render(h(Page));
    for (const id of ["instagram", "em-breve", "conexoes", "conexao-uazapi", "conexao-oficial", "conexao-meta"]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    const chips = Array.from(document.querySelectorAll("[data-secao-indice] nav a")).map((a) => a.textContent);
    expect(chips).toEqual(["Instagram", "Em breve", "Conexões e chaves"]);
    expect(isOpen("em-breve")).toBe(false);
    // Já configurado: fechado, com o resumo do que está salvo.
    expect(isOpen("conexao-uazapi")).toBe(false);
    expect(document.getElementById("conexao-uazapi")!.textContent).toContain("Usando o que você salvou aqui");
  });

  it("Configurações: cada bloco é uma seção com resumo", async () => {
    mockFetch({
      "/api/dashboard/stats": { instagramAccounts: [], workspace: { dmsSentThisPeriod: 12 } },
      "/api/workspace/members": { currentUserRole: "OWNER", members: [{ id: "m1", role: "OWNER", user: { name: "Matheus", email: "m@exemplo.com" } }], invitations: [] },
      "/api/account/security": { email: "m@exemplo.com", role: "USER", twoFactorEnabled: false, twoFactorRequired: false, googleEnabled: false, hasPassword: true, hasGoogle: false },
      "/api/workspace/api-tokens": { tokens: [], mcpUrl: "https://x.invalid/api/mcp", envTokenConfigured: false },
    });
    const { default: Page } = await import("../app/(dashboard)/settings/page");
    await render(h(Page));
    for (const id of ["instagram", "equipe", "seguranca", "gastos-ia", "pixel-meta", "api-mcp", "uso"]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    expect(isOpen("instagram")).toBe(true);
    expect(isOpen("seguranca")).toBe(false);
    expect(document.getElementById("uso")!.textContent).toContain("12 DMs enviadas este mês");
    expect(document.getElementById("equipe")!.textContent).toContain("1 pessoa · 0 convites pendentes");
  });

  it("/admin usa as seções e mantém as âncoras #chaves-ia e #gastos-ia", () => {
    const src = readFileSync(join(__dirname, "..", "app", "admin", "page.tsx"), "utf8");
    for (const id of ["acesso-beta", "chaves-ia", "gastos-ia", "usuarios", "numeros-whatsapp"]) expect(src).toContain(`id="${id}"`);
    expect(src).toContain("<SectionIndex");
  });

  it("no servidor a seção sai montada (campos e ids continuam no HTML)", () => {
    const rules = regras();
    const html = renderToStaticMarkup(h(RulesPanel, { text: rulesToText(rules), onText: () => undefined, rules, onRules: () => undefined, fromDoc: new Set<CampoTreino>() }));
    expect(html).toContain('id="regras"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Paulínia/SP");
  });
});
