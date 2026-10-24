/** 24/10/2026: seções do menu começam fechadas; só a da página aberta abre sozinha. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { alternarGrupo, GRUPOS_VAZIO, grupoAberto, lerGrupos } from "../lib/menu-grupos";

let pathname = "/posts";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

describe("menu: seções recolhíveis", () => {
  it("só a seção da página aberta começa aberta", () => {
    expect(grupoAberto(GRUPOS_VAZIO, "/posts", "Social Media", true)).toBe(true);
    expect(grupoAberto(GRUPOS_VAZIO, "/posts", "WhatsApp", false)).toBe(false);
  });

  it("abrir uma seção fecha a outra que estava aberta à mão, e a da página continua aberta", () => {
    let s = alternarGrupo(GRUPOS_VAZIO, "/posts", "WhatsApp", false);
    expect(grupoAberto(s, "/posts", "WhatsApp", false)).toBe(true);
    s = alternarGrupo(s, "/posts", "Quiz", false);
    expect(grupoAberto(s, "/posts", "Quiz", false)).toBe(true);
    expect(grupoAberto(s, "/posts", "WhatsApp", false)).toBe(false);
    expect(grupoAberto(s, "/posts", "Social Media", true)).toBe(true);
  });

  it("fechar a seção da página vale nesta página; em outra página volta ao padrão", () => {
    const s = alternarGrupo(GRUPOS_VAZIO, "/posts", "Social Media", true);
    expect(grupoAberto(s, "/posts", "Social Media", true)).toBe(false);
    expect(grupoAberto(s, "/inbox", "Social Media", false)).toBe(false);
    expect(grupoAberto(s, "/inbox", "Conversations", true)).toBe(true);
    // e a escolha fechada continua quando se abre outra seção
    const s2 = alternarGrupo(s, "/posts", "Home", false);
    expect(grupoAberto(s2, "/posts", "Social Media", true)).toBe(false);
  });

  it("lê lixo do navegador sem quebrar", () => {
    expect(lerGrupos(null)).toEqual(GRUPOS_VAZIO);
    expect(lerGrupos("{bad")).toEqual(GRUPOS_VAZIO);
    expect(lerGrupos('{"Home":true}')).toEqual(GRUPOS_VAZIO);
    expect(lerGrupos('{"path":"/x","open":{"Home":true,"Quiz":"sim"}}')).toEqual({ path: "/x", open: { Home: true } });
  });

  it("no menu, Posts fica em Social Media e as outras seções aparecem fechadas", async () => {
    const { default: Sidebar } = await import("../components/sidebar");
    pathname = "/posts";
    const html = renderToStaticMarkup(createElement(Sidebar, { isOpen: false, onClose: () => undefined, workspaceName: "Matheus", adminMenu: null }));
    const botoes = [...html.matchAll(/<button[^>]*aria-expanded="(true|false)"[^>]*>[\s\S]*?<span class="flex-1">([^<]+)<\/span>/g)].map((m) => [m[2], m[1]]);
    expect(botoes).toContainEqual(["Social Media", "true"]);
    expect(botoes.filter(([, aberto]) => aberto === "true")).toHaveLength(1);
    const secao = html.slice(html.indexOf(">Social Media<"));
    expect(secao.indexOf('href="/posts"')).toBeGreaterThan(-1);
    expect(secao.indexOf('href="/posts"')).toBeLessThan(secao.indexOf('href="/quizzes"'));
  });
});
