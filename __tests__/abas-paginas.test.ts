// @vitest-environment happy-dom
/**
 * Páginas em abas (07/10/2026; antes eram seções recolhíveis empilhadas):
 * WhatsApp > Agentes mostra só a aba ativa e o Salvar único salva o que foi
 * digitado em todas as abas; campo inválido leva pra aba dele; "Confira antes
 * de salvar" leva pro grupo em outra aba; Canais (#conexoes), Configurações e
 * /admin (#chaves-ia). Dados fictícios, fetch trocado por respostas prontas.
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
import { TabPanel, Tabs } from "../components/ui/tabs";
import { ReviewPanel } from "../components/whatsapp/treinar";
import { RulesPanel, rulesToText } from "../components/whatsapp/regras";
import type { CampoTreino, RascunhoTreino } from "../lib/whatsapp/treinar/esquema";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  // Deixa os fetch falsos responderem.
  await settle();
  return host;
}

const btn = (id: string) => document.getElementById(`${id}-botao`) as HTMLButtonElement | null;
const isOpen = (id: string) => btn(id)?.getAttribute("aria-expanded") === "true";
const tab = (id: string) => document.getElementById(`aba-${id}`) as HTMLButtonElement;
const panel = (id: string) => document.getElementById(`aba-${id}-painel`) as HTMLElement;
const activeTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-aba");
const tabLabels = () => Array.from(document.querySelectorAll('[role="tab"]')).map((b) => b.firstElementChild?.textContent);
const visiblePanels = () => Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]')).filter((p) => !p.hidden).map((p) => p.dataset.abaPainel);
const click = (el: Element) => act(async () => (el as HTMLElement).click());

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

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

type Call = { url: string; method: string; body: unknown };
let calls: Call[] = [];

function mockFetch(routes: Record<string, unknown>) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      // Cliente do better-auth (sessões abertas): lista vazia.
      if (url.includes("/list-sessions")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/get-session")) return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const body = key ? { success: true, data: routes[key] } : { success: false, error: "not mocked" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    })
  );
}

function agentRoutes(extra: Record<string, unknown> = {}) {
  return {
    "/api/whatsapp/status": { enabled: true, gatewayConfigured: true, uazapiConfigured: true, webhookReady: true, ai: { anthropic: true, openai: true } },
    "/api/whatsapp/agents/aprendizado": LEARNING,
    "/api/whatsapp/agents": VIEW,
    "/api/whatsapp/cerebro/": { documents: [] },
    ...extra,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/pagina");
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("WhatsApp > Agentes em abas", () => {
  it("mostra as abas e só o conteúdo da aba ativa, sem o índice nem Abrir tudo", async () => {
    mockFetch(agentRoutes());
    const { default: Page } = await import("../app/(dashboard)/whatsapp/agents/page");
    await render(h(Page));

    expect(tabLabels()).toEqual(["Número e modo", "Treinar", "Negócio", "Regras", "Agentes", "Leads", "Ritmo", "Testar", "Aprendizado"]);
    expect(document.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe("Configuração dos agentes");
    expect(activeTab()).toBe("numero");
    expect(visiblePanels()).toEqual(["numero"]);
    expect(document.querySelector("[data-secao-indice]")).toBeNull();
    expect(document.body.textContent).not.toContain("Abrir tudo");

    // Cada parte mora na sua aba.
    const where: Record<string, string[]> = {
      numero: ["numero"],
      treinar: ["treinar"],
      negocio: ["sobre"],
      regras: ["regras", "regras-onde", "regras-casos"],
      agentes: ["agente-qualificacao", "agente-atendimento", "agente-suporte"],
      leads: ["estagios"],
      ritmo: ["ritmo"],
      testar: ["testar"],
      aprendizado: ["aprendeu"],
    };
    for (const [aba, ids] of Object.entries(where)) {
      for (const id of ids) expect(document.getElementById(id)?.closest("[data-aba-painel]")?.getAttribute("data-aba-painel"), id).toBe(aba);
    }

    // Selo: 1 agente ligado.
    expect(tab("agentes").querySelector("[data-aba-selo]")!.textContent).toContain("1");

    // Troca de aba: aparece só ela. Cartões fixos; grupos das Regras recolhíveis com resumo.
    await click(tab("regras"));
    expect(visiblePanels()).toEqual(["regras"]);
    expect(document.getElementById("regras")!.hasAttribute("data-fixa")).toBe(true);
    expect(isOpen("regras-onde")).toBe(false);
    expect(document.getElementById("regras-onde")!.textContent).toContain("2 cidades atendidas · 1 fora · 0 com cuidado · 0 exceções");
    expect(document.getElementById("regras-quem")!.textContent).toContain("Responsável: Carla");
    const onde = document.getElementById("regras-onde")!;
    expect(onde.querySelector('button[aria-label="Tirar Paulínia/SP"]')).not.toBeNull();

    await click(tab("ritmo"));
    expect(visiblePanels()).toEqual(["ritmo"]);
    expect(window.location.search).toBe("?aba=ritmo");

    // Campos de todas as abas continuam montados (nada se perde).
    expect(document.querySelector('input[aria-label="Ligar Qualificação"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Comando base");
  });

  it("o Salvar fixo salva o que foi digitado em abas diferentes", async () => {
    mockFetch(agentRoutes());
    const { default: Page } = await import("../app/(dashboard)/whatsapp/agents/page");
    await render(h(Page));

    await click(tab("negocio"));
    const base = document.querySelector<HTMLTextAreaElement>("#sobre textarea")!;
    await act(async () => type(base, "Somos a Casa Firme. Atendemos Paulínia e Campinas."));

    await click(tab("ritmo"));
    const debounce = Array.from(document.querySelectorAll<HTMLInputElement>('#ritmo input[type="number"]')).find((i) => i.min === "3")!;
    await act(async () => type(debounce, "12"));

    await click(tab("agentes"));
    const suporte = document.querySelector<HTMLTextAreaElement>("#agente-suporte textarea")!;
    await act(async () => type(suporte, "Ajude com troca e entrega."));

    // Volta pra outra aba: o texto continua lá.
    await click(tab("negocio"));
    expect(document.querySelector<HTMLTextAreaElement>("#sobre textarea")!.value).toBe("Somos a Casa Firme. Atendemos Paulínia e Campinas.");

    const save = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Salvar")!;
    await click(save);
    await settle();
    const put = calls.find((c) => c.method === "PUT" && c.url === "/api/whatsapp/agents")!;
    expect(put).toBeTruthy();
    const body = put.body as { profile: { baseCommand: string; debounceSeconds: number }; agents: Array<{ agente: string; instrucoes: string }>; rules: RegrasNegocio };
    expect(body.profile.baseCommand).toBe("Somos a Casa Firme. Atendemos Paulínia e Campinas.");
    expect(body.profile.debounceSeconds).toBe(12);
    expect(body.agents.find((a) => a.agente === "suporte")!.instrucoes).toBe("Ajude com troca e entrega.");
    expect(body.rules.cidadesAtendidas).toHaveLength(2);
  });

  it("campo inválido em outra aba: o Salvar leva pra aba com o erro e não salva", async () => {
    mockFetch(agentRoutes());
    const { default: Page } = await import("../app/(dashboard)/whatsapp/agents/page");
    await render(h(Page));

    await click(tab("ritmo"));
    const debounce = Array.from(document.querySelectorAll<HTMLInputElement>('#ritmo input[type="number"]')).find((i) => i.min === "3")!;
    await act(async () => type(debounce, "90")); // máximo é 30
    await click(tab("numero"));
    expect(activeTab()).toBe("numero");

    const save = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Salvar")!;
    await click(save);
    await settle();
    expect(activeTab()).toBe("ritmo");
    expect(tab("ritmo").querySelector("[data-aba-selo]")!.textContent).toContain("Tem campo pra corrigir");
    expect(document.body.textContent).toContain("Corrija o campo marcado antes de salvar.");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("link direto (?aba=regras, #aprendeu) abre a aba certa", async () => {
    mockFetch(agentRoutes());
    const { default: Page } = await import("../app/(dashboard)/whatsapp/agents/page");
    window.history.replaceState(null, "", "/whatsapp/agents?aba=regras");
    await render(h(Page));
    // A página só monta as abas depois de carregar: o endereço vale mesmo assim.
    expect(activeTab()).toBe("regras");
    await act(async () => root!.unmount());
    host!.remove();

    window.history.replaceState(null, "", "/whatsapp/agents#aprendeu");
    await render(h(Page));
    expect(activeTab()).toBe("aprendizado");
  });

  it("número ligado com todos os agentes desligados: selo de aviso na aba Agentes", async () => {
    mockFetch(agentRoutes({ "/api/whatsapp/agents": { ...VIEW, agents: VIEW.agents.map((a) => ({ ...a, ativo: false })) } }));
    const { default: Page } = await import("../app/(dashboard)/whatsapp/agents/page");
    await render(h(Page));
    const selo = tab("agentes").querySelector("[data-aba-selo]")!;
    expect(selo.className).toContain("warning");
    expect(selo.textContent).toContain("Ligue pelo menos um agente na aba Agentes");
    expect(tab("numero").querySelector("[data-aba-selo]")).not.toBeNull();
  });

  it("sugestões novas no Aprendizado viram selo na aba", async () => {
    mockFetch(agentRoutes({ "/api/whatsapp/agents/aprendizado": { ...LEARNING, suggestions: [{ id: "g1", text: "Atender Sumaré", origin: "ia" }] } }));
    const { default: Page } = await import("../app/(dashboard)/whatsapp/agents/page");
    await render(h(Page));
    const selo = tab("aprendizado").querySelector("[data-aba-selo]")!;
    expect(selo).not.toBeNull();
    expect(selo.textContent).toContain("1 sugestão");
    expect(activeTab()).toBe("numero"); // não troca sozinho
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
  it("resumo com contagem por grupo, pendências em destaque e link que abre o grupo em outra aba", async () => {
    const rules = regras();
    await render(
      h(
        SectionsProvider,
        { page: "teste-conferir" },
        h(
          Tabs,
          { page: "teste-conferir", label: "Partes", tabs: [{ id: "treinar", label: "Treinar" }, { id: "regras", label: "Regras" }] },
          h(
            TabPanel,
            { id: "treinar" },
            h(ReviewPanel, {
              draft: draft(),
              saved: false,
              onClose: () => undefined,
              links: [{ id: "regras-onde", title: "Onde atende", summary: "2 cidades atendidas · 1 fora" }],
            })
          ),
          h(TabPanel, { id: "regras" }, h(RulesPanel, { text: rulesToText(rules), onText: () => undefined, rules, onRules: () => undefined, fromDoc: new Set<CampoTreino>() }))
        )
      )
    );
    const resumo = document.querySelector("[data-resumo-conferir]")!;
    expect(resumo.textContent).toContain("Pendências (A definir)2");
    expect(resumo.textContent).toContain("Não achei no documento1");
    expect(resumo.textContent).toContain("Onde atende");
    // Dentro da aba o painel fica fixo; os grupos com pendência abrem sozinhos.
    expect(document.getElementById("conferir")!.hasAttribute("data-fixa")).toBe(true);
    expect(document.getElementById("conferir")!.textContent).toContain("3 pra conferir");
    expect(isOpen("conferir-pendencias")).toBe(true);
    expect(isOpen("conferir-nao-achei")).toBe(true);
    expect(isOpen("conferir-contradicoes")).toBe(false);
    // Pendência vira selo na aba Treinar.
    expect(tab("treinar").querySelector("[data-aba-selo]")).not.toBeNull();

    // Link do resumo: troca pra aba Regras e abre o grupo.
    expect(activeTab()).toBe("treinar");
    const link = Array.from(resumo.querySelectorAll("a")).find((a) => a.getAttribute("href") === "#regras-onde")!;
    await click(link);
    expect(activeTab()).toBe("regras");
    expect(panel("regras").hidden).toBe(false);
    expect(isOpen("regras-onde")).toBe(true);
  });
});

describe("Canais, Configurações e /admin em abas", () => {
  function channelRoutes() {
    return {
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
    };
  }

  it("Canais: abas Instagram e Conexões e chaves, com os serviços como grupos", async () => {
    mockFetch(channelRoutes());
    const { default: Page } = await import("../app/(dashboard)/channels/page");
    await render(h(Page));
    expect(tabLabels()).toEqual(["Instagram", "Conexões e chaves"]);
    expect(visiblePanels()).toEqual(["instagram"]);
    expect(document.getElementById("em-breve")!.closest("[data-aba-painel]")!.getAttribute("data-aba-painel")).toBe("instagram");
    for (const id of ["conexoes", "conexao-uazapi", "conexao-oficial", "conexao-meta"]) {
      expect(document.getElementById(id)?.closest("[data-aba-painel]")?.getAttribute("data-aba-painel"), id).toBe("conexoes");
    }
    await click(tab("conexoes"));
    expect(visiblePanels()).toEqual(["conexoes"]);
    // Já configurado: grupo fechado, com o resumo do que está salvo.
    expect(isOpen("conexao-uazapi")).toBe(false);
    expect(document.getElementById("conexao-uazapi")!.textContent).toContain("Usando o que você salvou aqui");
  });

  it("Canais: o link antigo /channels#conexoes abre a aba Conexões e chaves", async () => {
    mockFetch(channelRoutes());
    window.history.replaceState(null, "", "/channels#conexoes");
    const { default: Page } = await import("../app/(dashboard)/channels/page");
    await render(h(Page));
    expect(activeTab()).toBe("conexoes");
    expect(visiblePanels()).toEqual(["conexoes"]);
  });

  it("Configurações: uma aba por bloco", async () => {
    mockFetch({
      "/api/dashboard/stats": { instagramAccounts: [], workspace: { dmsSentThisPeriod: 12 } },
      "/api/workspace/members": { currentUserRole: "OWNER", members: [{ id: "m1", role: "OWNER", user: { name: "Matheus", email: "m@exemplo.com" } }], invitations: [] },
      "/api/account/security": { email: "m@exemplo.com", role: "USER", twoFactorEnabled: false, twoFactorRequired: false, googleEnabled: false, hasPassword: true, hasGoogle: false },
      "/api/workspace/api-tokens": { tokens: [], mcpUrl: "https://x.invalid/api/mcp", envTokenConfigured: false },
    });
    window.history.replaceState(null, "", "/settings?aba=uso");
    const { default: Page } = await import("../app/(dashboard)/settings/page");
    await render(h(Page));
    expect(tabLabels()).toEqual(["Instagram", "Equipe", "Segurança", "Gasto de IA", "Pixel", "API e MCP", "Uso"]);
    for (const id of ["instagram", "equipe", "seguranca", "gastos-ia", "pixel-meta", "api-mcp", "uso"]) {
      expect(document.getElementById(id)?.closest("[data-aba-painel]")?.getAttribute("data-aba-painel"), id).toBe(id);
    }
    expect(visiblePanels()).toEqual(["uso"]);
    expect(document.getElementById("uso")!.textContent).toContain("DMs enviadas este mês");
    await click(tab("equipe"));
    expect(visiblePanels()).toEqual(["equipe"]);
    // Grupos da Segurança continuam recolhíveis dentro da aba.
    expect(btn("seguranca-sessoes")).not.toBeNull();
  });

  it("/admin: abas na ordem pedida e as âncoras #chaves-ia e #gastos-ia continuam", () => {
    const src = readFileSync(join(__dirname, "..", "app", "admin", "page.tsx"), "utf8");
    const order = ["acesso-beta", "usuarios", "chaves-ia", "gastos-ia", "numeros-whatsapp"].map((id) => src.indexOf(`<TabPanel id="${id}">`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const id of ["acesso-beta", "chaves-ia", "gastos-ia", "usuarios", "numeros-whatsapp"]) expect(src).toContain(`id="${id}"`);
    expect(src).toContain("<Tabs");
    expect(src).not.toContain("<SectionIndex");
  });

  it("/admin#chaves-ia abre a aba Chaves de IA", async () => {
    window.history.replaceState(null, "", "/admin#chaves-ia");
    await render(
      h(
        Tabs,
        { page: "admin", label: "Partes do admin", tabs: ["acesso-beta", "usuarios", "chaves-ia", "gastos-ia", "numeros-whatsapp"].map((id) => ({ id, label: id })) },
        ...["acesso-beta", "usuarios", "chaves-ia", "gastos-ia", "numeros-whatsapp"].map((id) => h(TabPanel, { id, key: id }, h("section", { id }, id)))
      )
    );
    expect(activeTab()).toBe("chaves-ia");
    expect(visiblePanels()).toEqual(["chaves-ia"]);
  });

  it("no servidor as abas saem com a primeira ativa e os painéis montados", () => {
    const rules = regras();
    const html = renderToStaticMarkup(
      h(
        Tabs,
        { page: "ssr", label: "Partes", tabs: [{ id: "a", label: "A" }, { id: "regras", label: "Regras" }] },
        h(TabPanel, { id: "a" }, h("p", null, "a")),
        h(TabPanel, { id: "regras" }, h(RulesPanel, { text: rulesToText(rules), onText: () => undefined, rules, onRules: () => undefined, fromDoc: new Set<CampoTreino>() }))
      )
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('id="aba-a" aria-selected="true"');
    expect(html).toContain('id="regras"');
    expect(html).toContain("Paulínia/SP");
  });
});
