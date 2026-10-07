// @vitest-environment happy-dom
/**
 * Seções recolhíveis (06/10/2026): abre e fecha, aria, teclado, lembra o
 * estado por página no localStorage, abre sozinha com aviso, funciona sem
 * localStorage, índice com Abrir tudo / Fechar tudo e chips de lista.
 */
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChipListInput,
  CollapsibleSection,
  SectionIndex,
  SectionsProvider,
  readSaved,
  storageKey,
} from "../components/ui/collapsible-section";
import { pt } from "../lib/i18n/pt";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

function rerender(node: ReactNode) {
  act(() => root!.render(node));
}

function unmount() {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
}

const btn = (id: string) => document.getElementById(`${id}-botao`) as HTMLButtonElement;
const region = (id: string) => document.getElementById(`${id}-conteudo`) as HTMLElement;
const isOpen = (id: string) => btn(id).getAttribute("aria-expanded") === "true";
const click = (el: Element) => act(() => (el as HTMLElement).click());

function page(extra: Partial<Parameters<typeof CollapsibleSection>[0]> = {}) {
  return h(
    SectionsProvider,
    { page: "teste" },
    h(SectionIndex, null),
    h(CollapsibleSection, { id: "a", title: "Primeira", summary: "2 cidades atendidas · 4 serviços", badge: { text: "configurado", tone: "success" } }, h("input", { id: "campo-a" })),
    h(CollapsibleSection, { id: "b", title: "Segunda", defaultOpen: false, summary: "nada ainda", ...extra }, h("p", null, "conteúdo b"))
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.innerHTML = "";
});
afterEach(() => {
  unmount();
  vi.restoreAllMocks();
});

describe("CollapsibleSection", () => {
  it("abre e fecha com aria-expanded, aria-controls e o conteúdo inerte quando fechado", () => {
    render(page());
    expect(isOpen("a")).toBe(true);
    expect(isOpen("b")).toBe(false);
    expect(btn("a").tagName).toBe("BUTTON");
    expect(btn("a").getAttribute("type")).toBe("button");
    expect(btn("a").getAttribute("aria-controls")).toBe("a-conteudo");
    expect(region("a").getAttribute("aria-labelledby")).toBe("a-botao");
    expect(region("b").hasAttribute("inert")).toBe(true);
    expect(region("a").hasAttribute("inert")).toBe(false);
    // O conteúdo fica montado mesmo fechado (ids e campos continuam lá).
    expect(document.getElementById("campo-a")).not.toBeNull();
    expect(region("b").textContent).toContain("conteúdo b");

    click(btn("b"));
    expect(isOpen("b")).toBe(true);
    click(btn("a"));
    expect(isOpen("a")).toBe(false);
  });

  it("mostra o resumo de uma linha e o selo só quando fechada", () => {
    render(page());
    const a = document.getElementById("a")!;
    expect(a.textContent).toContain("configurado");
    expect(a.querySelector("[data-secao-resumo]")).toBeNull();
    click(btn("a"));
    expect(a.querySelector("[data-secao-resumo]")?.textContent).toBe("2 cidades atendidas · 4 serviços");
  });

  it("teclado: seta pra baixo e pra cima, Home e End passam pelos cabeçalhos", () => {
    render(page());
    btn("a").focus();
    act(() => {
      btn("a").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(btn("b"));
    act(() => {
      btn("b").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(document.activeElement).toBe(btn("a"));
    act(() => {
      btn("a").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    expect(document.activeElement).toBe(btn("b"));
    act(() => {
      btn("b").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    expect(document.activeElement).toBe(btn("a"));
  });

  it("lembra aberto e fechado por página e por seção", () => {
    render(page());
    click(btn("a"));
    click(btn("b"));
    expect(readSaved("teste")).toEqual({ a: false, b: true });
    unmount();
    render(page());
    expect(isOpen("a")).toBe(false);
    expect(isOpen("b")).toBe(true);
    // Outra página não herda.
    expect(readSaved("outra")).toEqual({});
  });

  it("ignora um valor estragado no localStorage", () => {
    window.localStorage.setItem(storageKey("teste"), "{não é json");
    render(page());
    expect(isOpen("a")).toBe(true);
    expect(isOpen("b")).toBe(false);
  });

  it("abre sozinha quando aparece um aviso, mesmo que estivesse fechada", () => {
    window.localStorage.setItem(storageKey("teste"), JSON.stringify({ b: false }));
    render(page({ attention: false }));
    expect(isOpen("b")).toBe(false);
    rerender(page({ attention: true }));
    expect(isOpen("b")).toBe(true);
    // A pessoa pode fechar de novo depois.
    click(btn("b"));
    expect(isOpen("b")).toBe(false);
  });

  it("já começa aberta quando a página carrega com aviso", () => {
    window.localStorage.setItem(storageKey("teste"), JSON.stringify({ b: false }));
    render(page({ attention: true }));
    expect(isOpen("b")).toBe(true);
  });

  it("abre quando um campo dentro dela fica inválido", () => {
    render(
      h(SectionsProvider, { page: "teste" }, h(CollapsibleSection, { id: "c", title: "C", defaultOpen: false }, h("input", { id: "obrigatorio", required: true })))
    );
    expect(isOpen("c")).toBe(false);
    act(() => {
      document.getElementById("obrigatorio")!.dispatchEvent(new Event("invalid", { bubbles: false, cancelable: true }));
    });
    expect(isOpen("c")).toBe(true);
  });

  it("funciona igual sem localStorage (só não lembra)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    render(page());
    expect(isOpen("a")).toBe(true);
    click(btn("a"));
    expect(isOpen("a")).toBe(false);
    click(btn("a"));
    expect(isOpen("a")).toBe(true);
  });

  it("funciona sem SectionsProvider", () => {
    render(h(CollapsibleSection, { id: "solta", title: "Solta", defaultOpen: false }, "x"));
    expect(isOpen("solta")).toBe(false);
    click(btn("solta"));
    expect(isOpen("solta")).toBe(true);
  });
});

describe("SectionIndex", () => {
  it("lista as seções na ordem da tela, rola e abre ao clicar", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    render(page());
    const chips = Array.from(document.querySelectorAll("[data-secao-indice] nav a"));
    expect(chips.map((c) => c.textContent)).toEqual(["Primeira", "Segunda"]);
    expect(chips[1].getAttribute("href")).toBe("#b");
    click(chips[1]);
    expect(isOpen("b")).toBe(true);
    expect(scroll).toHaveBeenCalled();
  });

  it("Abrir tudo e Fechar tudo", () => {
    render(page());
    const [abrir, fechar] = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-secao-indice] > div button"));
    expect(abrir.textContent).toBe("Abrir tudo");
    expect(fechar.textContent).toBe("Fechar tudo");
    click(abrir);
    expect([isOpen("a"), isOpen("b")]).toEqual([true, true]);
    expect(abrir.disabled).toBe(true);
    click(fechar);
    expect([isOpen("a"), isOpen("b")]).toEqual([false, false]);
    expect(fechar.disabled).toBe(true);
    expect(readSaved("teste")).toEqual({ a: false, b: false });
  });

  it("o índice rola na horizontal (não quebra a página no celular)", () => {
    render(page());
    const ul = document.querySelector("[data-secao-indice] nav ul")!;
    expect(ul.className).toContain("overflow-x-auto");
    expect(ul.className).toContain("whitespace-nowrap");
  });
});

describe("ChipListInput", () => {
  it("vira chips, adiciona com Enter e tira com o x, mantendo o texto um por linha", () => {
    let value = "Paulínia/SP\nCampinas/SP";
    const onChange = (v: string) => {
      value = v;
      rerender(h(ChipListInput, { value, onChange, label: "Cidades", id: "cid" }));
    };
    render(h(ChipListInput, { value, onChange, label: "Cidades", id: "cid" }));
    expect(host!.textContent).toContain("(2)");
    const input = document.getElementById("cid") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Sumaré/SP");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(value).toBe("Paulínia/SP\nCampinas/SP\nSumaré/SP");
    click(host!.querySelector('button[aria-label="Tirar Campinas/SP"]')!);
    expect(value).toBe("Paulínia/SP\nSumaré/SP");
  });

  it("todos os textos novos têm tradução", () => {
    for (const k of ["On this page", "Open all", "Close all", "Remove {item}", "Type and press Enter"]) expect(pt[k]).toBeTruthy();
  });
});
