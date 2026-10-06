/**
 * Item "Admin" no menu lateral (06/10/2026, pedido do dono: "quero que apareça
 * no menu só pra mim que sou admin") e os textos da tela Conexões e chaves.
 * - admin com 2FA vê o item, levando pro /admin;
 * - admin sem 2FA vê o item levando pra tela de ligar o 2FA, com aviso;
 * - usuário comum não recebe o item (nem no HTML);
 * - a regra é a mesma do requirePlatformAdmin e só olha a sessão (chave de API não muda nada).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => null),
  needsTwoFactorSetup: (u: { role: string; twoFactorEnabled: boolean } | null) => Boolean(u && u.role === "ADMIN" && !u.twoFactorEnabled),
}));

import Sidebar, { adminSection } from "../components/sidebar";
import { adminMenuState } from "../lib/platform-admin";
import { pt } from "../lib/i18n/pt";
import { FIELD_TEXT, IntegrationsPanel, SERVICE_TEXT, integrationErrorText, testResultText, type IntegrationsData } from "../components/integrations-panel";

function render(adminMenu: ReturnType<typeof adminMenuState>, pathname: string) {
  nav.pathname = pathname;
  return renderToStaticMarkup(createElement(Sidebar, { isOpen: false, onClose: () => undefined, workspaceName: "Matheus", adminMenu }));
}

describe("Admin no menu", () => {
  it("mesma regra do requirePlatformAdmin", () => {
    expect(adminMenuState({ role: "ADMIN", twoFactorEnabled: true })).toBe("admin");
    expect(adminMenuState({ role: "ADMIN", twoFactorEnabled: false })).toBe("needs_2fa");
    expect(adminMenuState({ role: "USER", twoFactorEnabled: true })).toBeNull();
    expect(adminMenuState(null)).toBeNull();
    expect(adminMenuState(undefined)).toBeNull();
  });

  it("admin com 2FA vê o grupo Admin da plataforma com o link pro /admin", () => {
    const html = render("admin", "/admin");
    expect(html).toContain("Admin da plataforma");
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain("verificação em duas etapas");
  });

  it("o grupo fica no fim do menu, fechado fora do /admin", () => {
    const html = render("admin", "/dashboard");
    expect(html).toContain("Admin da plataforma");
    expect(html.lastIndexOf("Admin da plataforma")).toBeGreaterThan(html.lastIndexOf("Canais"));
  });

  it("admin sem 2FA vê o item levando pra ligar o 2FA, com aviso curto", () => {
    const html = render("needs_2fa", "/account/two-factor");
    expect(html).toContain('href="/account/two-factor"');
    expect(html).toContain("Ligue a verificação em duas etapas pra abrir o Admin.");
    expect(html).not.toContain('href="/admin"');
  });

  it("usuário comum não recebe o item nem no HTML", () => {
    for (const path of ["/dashboard", "/admin", "/account/two-factor"]) {
      const html = render(null, path);
      expect(html).not.toContain("Admin da plataforma");
      expect(html).not.toContain('href="/admin"');
    }
    expect(adminSection(null)).toBeNull();
  });
});

describe("Textos de Conexões e chaves", () => {
  const t = (s: string) => s;

  it("todo texto indireto tem tradução e não usa travessão", () => {
    const shown = [
      ...Object.values(FIELD_TEXT).flatMap((fields) => Object.values(fields).flatMap((f) => [f.label, f.placeholder, f.hint].filter(Boolean) as string[])),
      ...Object.values(SERVICE_TEXT).flatMap((s) => [s.title, s.where]),
      ...["url_invalid", "url_not_https", "url_internal", "secret_invalid", "number_invalid", "rate_limited", "forbidden", "human_only", undefined].map((c) =>
        integrationErrorText(t, c)
      ),
      ...["ok", "not_configured", "unauthorized", "timeout", "unreachable", "url_blocked", "bad_response"].map((code) =>
        testResultText(t, { ok: code === "ok", code, source: null, checkedAt: "" })
      ),
      "saved",
      "replaced",
      "removed",
      "tested the connection of",
      "Platform admin",
      "Admin",
    ].filter((s) => !/^\d+$/.test(s));
    expect(shown.filter((s) => !(s in pt))).toEqual([]);
    const ours = shown.map((s) => pt[s]);
    expect(ours.filter((s) => /[—–]/.test(s))).toEqual([]);
    expect(ours.filter((s) => /\btu\b/i.test(s))).toEqual([]);
  });
});

describe("Tela Conexões e chaves", () => {
  const field = (f: string, kind: "url" | "secret" | "number", saved: boolean, last4: string | null = null) => ({
    field: f,
    kind,
    saved,
    last4,
    number: kind === "number" && saved ? 2 : null,
    updatedAt: saved ? "2026-10-06T12:00:00.000Z" : null,
    updatedBy: saved ? "Matheus" : null,
  });
  const data = (ai: IntegrationsData["ai"]): IntegrationsData => ({
    whatsappEnabled: true,
    audit: [],
    ai,
    services: [
      {
        service: "uazapi",
        source: "workspace",
        workspaceComplete: true,
        envConfigured: false,
        fields: [field("serverUrl", "url", true, ".com"), field("adminToken", "secret", true, "x9Zk"), field("maxInstances", "number", true)],
      },
      { service: "openwa", source: "env", workspaceComplete: false, envConfigured: true, fields: [field("baseUrl", "url", false), field("apiKey", "secret", false)] },
    ],
  });

  it("mostra os cartões, só os 4 últimos, de onde vem e a API oficial em breve", () => {
    const html = renderToStaticMarkup(createElement(IntegrationsPanel, { initial: data(null) }));
    expect(html).toContain('id="conexoes"');
    expect(html).toContain("WhatsApp · uazapi");
    expect(html).toContain("Salvo, termina em ••••x9Zk");
    expect(html).toContain("Usando o que você salvou aqui");
    expect(html).toContain("Usando a configuração do servidor");
    expect(html).toContain("API oficial (Cloud API)");
    expect(html).toContain("Onde pegar: no painel da uazapi");
    expect(html).not.toContain("Chaves de IA (plataforma)");
  });

  it("status das chaves de IA só quando o servidor manda (admin da plataforma)", () => {
    const html = renderToStaticMarkup(createElement(IntegrationsPanel, { initial: data({ anthropic: true, openai: false, typesafe: false }) }));
    expect(html).toContain("Chaves de IA (plataforma)");
    expect(html).toContain('href="/admin#chaves-ia"');
  });
});
