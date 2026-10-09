/**
 * Botão de sair e página de criar conta (09/10/2026, pedido do dono: "cria o botão
 * de saída da conta" e "página de criar conta").
 * - o menu lateral sempre mostra "Sair";
 * - o formulário da /signup abre no link por e-mail (é ele, ou o Google, que cria a conta);
 * - o cadastro por senha continua fechado (disableSignUp).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), needsTwoFactorSetup: () => false }));

import Sidebar from "../components/sidebar";
import { LoginForm } from "../components/auth/login-form";
import { pt } from "../lib/i18n/pt";

describe("Sair e criar conta", () => {
  it("o menu lateral tem o botão Sair", () => {
    const html = renderToStaticMarkup(createElement(Sidebar, { isOpen: false, onClose: () => undefined, workspaceName: "Matheus", adminMenu: null }));
    expect(html).toContain(pt["Sign out"] ?? "Sign out");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*?(Sair|Sign out)/);
  });

  it("o formulário da /signup abre no link por e-mail", () => {
    const comLink = renderToStaticMarkup(createElement(LoginForm, { callbackUrl: "/dashboard", googleEnabled: false, initialError: null, initialMode: "link" }));
    const padrao = renderToStaticMarkup(createElement(LoginForm, { callbackUrl: "/dashboard", googleEnabled: false, initialError: null }));
    expect(comLink).not.toContain('type="password"');
    expect(padrao).toContain('type="password"');
  });

  it("cadastro por senha continua fechado e a /login aponta pra /signup", () => {
    const raiz = join(__dirname, "..");
    expect(readFileSync(join(raiz, "lib/auth-config.ts"), "utf8")).toMatch(/disableSignUp:\s*true/);
    expect(readFileSync(join(raiz, "app/login/page.tsx"), "utf8")).toContain('href="/signup"');
  });

  it("os textos novos têm tradução", () => {
    for (const k of ["Signing out...", "Create account", "Already have an account?", "Create account - Lead Engine"]) {
      expect(pt[k], k).toBeTruthy();
    }
  });
});
