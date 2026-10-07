// @vitest-environment happy-dom
/**
 * Abas do painel (07/10/2026): troca de aba, teclado, aria, aba no endereço
 * (?aba=, #aba, âncora antiga e #id de dentro do painel), lembrar no
 * localStorage (e funcionar sem ele), selo, campo inválido leva pra aba,
 * link de outra aba abre a aba certa, cartão fixo dentro da aba e nada
 * digitado se perde ao trocar de aba.
 */
import { act, createElement as h, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollapsibleSection, openAndScroll, SectionsProvider, useSections } from "../components/ui/collapsible-section";
import { checkFieldsInTabs, readSavedTab, tabFromLocation, TabPanel, Tabs, tabStorageKey, type TabItem } from "../components/ui/tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}
async function rerender(node: ReactNode) {
  await act(async () => root!.render(node));
}
async function unmount() {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

const tab = (id: string) => document.getElementById(`aba-${id}`) as HTMLButtonElement;
const panel = (id: string) => document.getElementById(`aba-${id}-painel`) as HTMLElement;
const activeTab = () => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-aba");
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

const TABS: TabItem[] = [
  { id: "a", label: "Primeira" },
  { id: "b", label: "Segunda", badge: { text: "3", tone: "warning", label: "3 pra conferir" } },
  { id: "c", label: "Terceira", aliases: ["antiga"] },
];

function page(extra?: { tabs?: TabItem[]; c?: ReactNode }) {
  return h(
    SectionsProvider,
    { page: "teste-abas" },
    h(
      Tabs,
      { page: "teste-abas", label: "Partes", tabs: extra?.tabs ?? TABS },
      h(TabPanel, { id: "a" }, h(CollapsibleSection, { id: "cartao-a", title: "Cartão A", summary: "resumo" }, h("input", { id: "campo-a", "aria-label": "campo a" }))),
      h(TabPanel, { id: "b" }, h("p", null, "conteúdo b"), h(CollapsibleSection, { id: "grupo-b", title: "Grupo B", variant: "group", defaultOpen: false }, h("p", { id: "dentro-b" }, "dentro do grupo"))),
      h(TabPanel, { id: "c" }, extra?.c ?? h("input", { id: "numero-c", type: "number", min: 0, max: 10, defaultValue: "5", "aria-label": "número c" }))
    )
  );
}

function setUrl(path: string) {
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
  setUrl("/pagina");
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

describe("Abas", () => {
  it("tem tablist, tab e tabpanel com aria e mostra só a aba ativa", async () => {
    await render(page());
    const list = document.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Partes");
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(tab("a").getAttribute("aria-selected")).toBe("true");
    expect(tab("a").getAttribute("aria-controls")).toBe("aba-a-painel");
    expect(panel("a").getAttribute("role")).toBe("tabpanel");
    expect(panel("a").getAttribute("aria-labelledby")).toBe("aba-a");
    expect(panel("a").hidden).toBe(false);
    expect(panel("b").hidden).toBe(true);
    expect(panel("c").hidden).toBe(true);
    // Só a aba ativa entra no Tab do teclado.
    expect(tab("a").tabIndex).toBe(0);
    expect(tab("b").tabIndex).toBe(-1);

    await click(tab("b"));
    expect(activeTab()).toBe("b");
    expect(panel("a").hidden).toBe(true);
    expect(panel("b").hidden).toBe(false);
    expect(tab("b").tabIndex).toBe(0);
  });

  it("setas, Home e End trocam de aba e levam o foco", async () => {
    await render(page());
    tab("a").focus();
    await key(tab("a"), "ArrowRight");
    expect(activeTab()).toBe("b");
    expect(document.activeElement).toBe(tab("b"));
    await key(tab("b"), "ArrowLeft");
    expect(activeTab()).toBe("a");
    await key(tab("a"), "ArrowLeft"); // dá a volta
    expect(activeTab()).toBe("c");
    await key(tab("c"), "Home");
    expect(activeTab()).toBe("a");
    await key(tab("a"), "End");
    expect(activeTab()).toBe("c");
    expect(document.activeElement).toBe(tab("c"));
  });

  it("abre a aba do endereço: ?aba=, #aba, âncora antiga e #id de dentro do painel", async () => {
    setUrl("/pagina?aba=b");
    await render(page());
    expect(activeTab()).toBe("b");
    await unmount();

    setUrl("/pagina#c");
    await render(page());
    expect(activeTab()).toBe("c");
    await unmount();

    setUrl("/pagina#antiga");
    await render(page());
    expect(activeTab()).toBe("c");
    await unmount();

    setUrl("/pagina#dentro-b");
    await render(page());
    expect(activeTab()).toBe("b");
    await unmount();

    // Aba que não existe: fica na primeira.
    setUrl("/pagina?aba=nada");
    await render(page());
    expect(activeTab()).toBe("a");
  });

  it("tabFromLocation entende ?aba, #aba e alias", () => {
    expect(tabFromLocation(TABS, { search: "?aba=c", hash: "" })).toBe("c");
    expect(tabFromLocation(TABS, { search: "", hash: "#b" })).toBe("b");
    expect(tabFromLocation(TABS, { search: "", hash: "#antiga" })).toBe("c");
    expect(tabFromLocation(TABS, { search: "", hash: "" })).toBeNull();
    expect(tabFromLocation(TABS, { search: "?aba=x", hash: "#y" })).toBeNull();
  });

  it("põe a aba no endereço e lembra no localStorage depois de recarregar", async () => {
    await render(page());
    await click(tab("c"));
    expect(window.location.search).toBe("?aba=c");
    expect(window.localStorage.getItem(tabStorageKey("teste-abas"))).toBe("c");
    expect(readSavedTab("teste-abas")).toBe("c");
    await unmount();

    setUrl("/pagina");
    await render(page());
    expect(activeTab()).toBe("c");
    await unmount();

    // O endereço ganha do lembrado.
    setUrl("/pagina?aba=b");
    await render(page());
    expect(activeTab()).toBe("b");
  });

  it("sem localStorage funciona igual, só não lembra", async () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("bloqueado");
      },
    });
    try {
      await render(page());
      expect(activeTab()).toBe("a");
      await click(tab("b"));
      expect(activeTab()).toBe("b");
      expect(readSavedTab("teste-abas")).toBeNull();
    } finally {
      if (real) Object.defineProperty(window, "localStorage", real);
      else delete (window as { localStorage?: Storage }).localStorage;
    }
  });

  it("mostra o selo da aba e um ponto sozinho quando uma seção do painel pede atenção", async () => {
    await render(page());
    const seloB = tab("b").querySelector("[data-aba-selo]")!;
    expect(seloB.textContent).toContain("3");
    expect(seloB.textContent).toContain("3 pra conferir"); // leitor de tela
    expect(tab("c").querySelector("[data-aba-selo]")).toBeNull();

    await rerender(page({ c: h(CollapsibleSection, { id: "cartao-c", title: "Cartão C", attention: true, badge: { text: "2 sugestões", tone: "accent" } }, h("p", null, "c")) }));
    const seloC = tab("c").querySelector("[data-aba-selo]")!;
    expect(seloC).not.toBeNull();
    expect(seloC.textContent).toContain("2 sugestões");
    // A atenção não troca de aba sozinha.
    expect(activeTab()).toBe("a");

    await rerender(page({ c: h(CollapsibleSection, { id: "cartao-c", title: "Cartão C" }, h("p", null, "c")) }));
    expect(tab("c").querySelector("[data-aba-selo]")).toBeNull();
  });

  it("campo inválido em outra aba: abre a aba dele, marca o selo e não deixa salvar", async () => {
    await render(page());
    const input = document.getElementById("numero-c") as HTMLInputElement;
    await act(async () => {
      input.value = "50";
    });
    let ok = true;
    await act(async () => {
      ok = checkFieldsInTabs(host);
    });
    expect(ok).toBe(false);
    expect(activeTab()).toBe("c");
    expect(tab("c").querySelector("[data-aba-selo]")!.textContent).toContain("Tem campo pra corrigir");

    // Corrigiu: o selo some e o Salvar passa.
    await act(async () => {
      input.value = "7";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(tab("c").querySelector("[data-aba-selo]")).toBeNull();
    expect(checkFieldsInTabs(host)).toBe(true);
  });

  it("link pra uma seção de outra aba abre a aba e o grupo", async () => {
    function Link() {
      const s = useSections();
      return h("button", { id: "ir", type: "button", onClick: () => openAndScroll(s, "grupo-b") }, "ir");
    }
    await render(h(SectionsProvider, { page: "teste-abas" }, h(Link), page().props.children));
    expect(activeTab()).toBe("a");
    expect(document.getElementById("grupo-b-botao")!.getAttribute("aria-expanded")).toBe("false");
    await click(document.getElementById("ir")!);
    expect(activeTab()).toBe("b");
    expect(document.getElementById("grupo-b-botao")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("dentro da aba o cartão da página fica fixo e o grupo continua recolhível", async () => {
    await render(page());
    const cartao = document.getElementById("cartao-a")!;
    expect(cartao.hasAttribute("data-fixa")).toBe(true);
    expect(document.getElementById("cartao-a-botao")).toBeNull();
    expect(cartao.querySelector("h2")!.textContent).toBe("Cartão A");
    expect(cartao.textContent).not.toContain("resumo"); // resumo é só de seção fechada
    expect(document.getElementById("grupo-b-botao")).not.toBeNull();
  });

  it("trocar de aba não perde o que foi digitado", async () => {
    function Form() {
      const [v, setV] = useState("");
      return h(
        Tabs,
        { page: "teste-form", label: "Form", tabs: TABS.slice(0, 2) },
        h(TabPanel, { id: "a" }, h("input", { id: "nome", value: v, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV(e.target.value) })),
        h(TabPanel, { id: "b" }, h("p", { id: "eco" }, v))
      );
    }
    await render(h(Form));
    const input = document.getElementById("nome") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Casa Firme");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(tab("b"));
    expect(document.getElementById("eco")!.textContent).toBe("Casa Firme");
    await click(tab("a"));
    expect((document.getElementById("nome") as HTMLInputElement).value).toBe("Casa Firme");
  });
});
