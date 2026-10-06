/**
 * Formato da DM do link (06/10/2026): cartão com botão (BUTTON, o de antes) ou
 * texto com o link rastreado dentro (TEXT, aparece em qualquer Instagram).
 * - o texto montado: {link} no meio ou no fim, segundo link com rótulo, limite
 *   de 1000 caracteres da Meta sem nunca cortar um link;
 * - a migração: só aditiva, roda em banco vazio e deixa BUTTON em tudo que já
 *   existia (nenhuma campanha muda de comportamento).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { migrationNames } from "./helpers/pglite-db";
import CampaignPreview from "../components/campaign-preview";
import { composeLinkText, DM_TEXT_LIMIT, parseDmFormat } from "../lib/tracking/message";

const URL1 = "https://app.test/r/abc123?c=42.sig";
const URL2 = "https://app.test/r/def456?c=42.sig";

describe("composeLinkText", () => {
  it("{link} no meio vira o link rastreado, e {username} o @", () => {
    expect(
      composeLinkText({ message: "Oi {username}, pega: {link} valeu", commenterName: "ana", primary: URL1 })
    ).toBe(`Oi ana, pega: ${URL1} valeu`);
  });

  it("{link} no fim", () => {
    expect(composeLinkText({ message: "Aqui está {link}", primary: URL1 })).toBe(`Aqui está ${URL1}`);
  });

  it("sem {link}: o link vai no fim, numa linha própria", () => {
    expect(composeLinkText({ message: "Aqui está o material ", primary: URL1 })).toBe(`Aqui está o material\n${URL1}`);
  });

  it("sem {link} mas com o link de destino digitado: troca pelo rastreado", () => {
    expect(
      composeLinkText({
        message: "Acessa https://dest.com/oferta agora",
        primary: URL1,
        destinationUrl: "https://dest.com/oferta",
      })
    ).toBe(`Acessa ${URL1} agora`);
  });

  it("segundo link: linha própria com o rótulo; rótulo padrão não aparece", () => {
    expect(
      composeLinkText({ message: "Toma {link}", primary: URL1, extraLinks: [{ url: URL2, label: "Grupo VIP" }] })
    ).toBe(`Toma ${URL1}\nGrupo VIP: ${URL2}`);
    expect(
      composeLinkText({ message: "Toma {link}", primary: URL1, extraLinks: [{ url: URL2, label: "Open link" }] })
    ).toBe(`Toma ${URL1}\n${URL2}`);
  });

  it("passou de 1000 caracteres: corta as palavras, nunca os links", () => {
    const long = `${"palavra ".repeat(200)}{link}`;
    const text = composeLinkText({ message: long, primary: URL1, extraLinks: [{ url: URL2, label: "Grupo" }] });
    expect(text.length).toBeLessThanOrEqual(DM_TEXT_LIMIT);
    expect(text).toContain(URL1);
    expect(text).toContain(`Grupo: ${URL2}`);
    expect(text).toContain("…");
  });

  it("sem link nenhum: só a mensagem", () => {
    expect(composeLinkText({ message: "Oi {username}", commenterName: "ana" })).toBe("Oi ana");
  });
});

describe("prévia da DM na tela da automação", () => {
  const props = {
    tab: "dm" as const,
    onTabChange: () => undefined,
    username: "omatheus.ai",
    avatarUrl: null,
    postThumb: null,
    caption: "",
    sampleComment: "LINK",
    dmTriggerEnabled: false,
    publicReplyEnabled: false,
    publicReplyMessage: "",
    openingDmEnabled: false,
    openingDmMessage: "",
    openingDmButtonLabel: "",
    revealMessage: "Oi {username}, pega aqui",
    hasLink: true,
    linkButtonLabel: "Acessar",
    linkUrl: "https://dest.com/oferta",
    hasSecondLink: true,
    secondLinkButtonLabel: "Grupo VIP",
    secondLinkUrl: "https://dest.com/grupo",
    requireFollow: false,
    followPromptMessage: "",
    followPromptButtonLabel: "",
    followUpEnabled: false,
    followUpMessage: "",
  };
  const render = (dmFormat: "BUTTON" | "TEXT") =>
    renderToStaticMarkup(createElement(CampaignPreview, { ...props, dmFormat }));

  it("TEXT: o texto com os links dentro, sem os botões", () => {
    const html = render("TEXT");
    expect(html).toContain("Oi username, pega aqui\n");
    expect(html).toContain("https://dest.com/oferta</span>");
    expect(html).toMatch(/Grupo VIP: <\/span><span class="text-sky-400[^>]*>https:\/\/dest\.com\/grupo</);
    expect(html).not.toContain(">Acessar<");
  });

  it("BUTTON: o cartão com os dois botões", () => {
    const html = render("BUTTON");
    expect(html).toContain(">Acessar<");
    expect(html).toContain(">Grupo VIP<");
    expect(html).not.toContain("https://dest.com/oferta");
  });
});

describe("parseDmFormat", () => {
  it("aceita button/text em qualquer caixa e recusa o resto", () => {
    expect(parseDmFormat("text")).toBe("TEXT");
    expect(parseDmFormat(" Button ")).toBe("BUTTON");
    expect(parseDmFormat("TEXT")).toBe("TEXT");
    expect(parseDmFormat("card")).toBeUndefined();
    expect(parseDmFormat(1)).toBeUndefined();
  });
});

describe("migração 20261017120000_dm_formato_texto", () => {
  const MIGRATIONS = join(__dirname, "..", "prisma", "migrations");
  const NAME = "20261017120000_dm_formato_texto";
  const sql = readFileSync(join(MIGRATIONS, NAME, "migration.sql"), "utf8");
  let db: PGlite | undefined;

  afterAll(async () => {
    await db?.close();
  });

  it("vem depois da uazapi e é só aditiva (nenhum DROP, DELETE, UPDATE ou mudança de tipo)", () => {
    // Migrações novas podem vir depois (ex.: 20261018120000_wa_excluir_numero); a ordem com a anterior é o que importa.
    const names = migrationNames();
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("20261016120000_wa_uazapi"));
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it("roda em banco vazio e campanha que já existia fica BUTTON", async () => {
    db = new PGlite();
    for (const name of migrationNames().filter((n) => n !== NAME)) {
      await db.exec(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
    }
    await db.exec(`
      INSERT INTO "User"(id, email, "updatedAt") VALUES ('u1', 'a@ex.com', now());
      INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES ('ws1', 'A', 'u1', now());
      INSERT INTO "InstagramAccount"(id, "workspaceId", "instagramId", username, "accessToken", "updatedAt")
        VALUES ('acc1', 'ws1', '1784', 'conta', 'enc', now());
      INSERT INTO "Automation"(id, "workspaceId", "instagramAccountId", name, keywords, "dmMessage", "updatedAt")
        VALUES ('antiga', 'ws1', 'acc1', 'Antes da migração', ARRAY['LINK'], 'oi {link}', now());
    `);
    await db.exec(sql);

    const old = await db.query<{ dmFormat: string }>(`SELECT "dmFormat" FROM "Automation" WHERE id = 'antiga'`);
    expect(old.rows[0].dmFormat).toBe("BUTTON");

    // Quem não manda o campo (código antigo, import) também cai em BUTTON.
    await db.exec(`
      INSERT INTO "Automation"(id, "workspaceId", "instagramAccountId", name, keywords, "dmMessage", "updatedAt")
        VALUES ('nova', 'ws1', 'acc1', 'Sem campo', ARRAY['LINK'], 'oi', now());
      INSERT INTO "Automation"(id, "workspaceId", "instagramAccountId", name, keywords, "dmMessage", "dmFormat", "updatedAt")
        VALUES ('texto', 'ws1', 'acc1', 'Texto', ARRAY['LINK'], 'oi', 'TEXT', now());
    `);
    const rows = await db.query<{ id: string; dmFormat: string }>(
      `SELECT id, "dmFormat" FROM "Automation" WHERE id IN ('nova', 'texto') ORDER BY id`
    );
    expect(rows.rows).toEqual([
      { id: "nova", dmFormat: "BUTTON" },
      { id: "texto", dmFormat: "TEXT" },
    ]);
    await expect(
      db.exec(`UPDATE "Automation" SET "dmFormat" = 'CARD' WHERE id = 'nova'`)
    ).rejects.toThrow();
  }, 60_000);
});
