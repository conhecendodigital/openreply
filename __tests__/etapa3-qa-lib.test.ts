/**
 * QA da Etapa 3 fora do worker (2026-10-06):
 *  - menu por seções: toda rota de app/(dashboard) aparece uma vez, com ícone e
 *    tradução (os rótulos passam por t() dinâmico, que o teste de i18n não pega);
 *  - busca de @: o webhook nunca chega na API de perfil, negado não repete a
 *    cada evento, a fila fora do ar não segura o webhook 2 s por mensagem;
 *  - backfill idempotente contra um banco em memória;
 *  - nome na tela sem @ (nome, senão "Pessoa do Direct ···1234").
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Contact = {
  id: string;
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePicUrl: string | null;
  profileStatus: string | null;
  profileFetchedAt: Date | null;
  profileAttempts: number;
  instagramAccountId: string;
};

const h = vi.hoisted(() => ({
  contacts: [] as Contact[],
  prisma: {
    contact: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    dmLog: { findFirst: vi.fn() },
    commentModeration: { findFirst: vi.fn() },
    instagramAccount: { findMany: vi.fn() },
  },
  getUserProfile: vi.fn(),
  reserveProfileSlot: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/meta/client", () => ({ getUserProfile: h.getUserProfile }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/utils/rate-limiter", () => ({ reserveProfileSlot: h.reserveProfileSlot }));
vi.mock("@/lib/channels/status", () => ({
  noteMetaError: vi.fn(),
  isTokenRejected: (e: unknown) => e instanceof Error && e.name === "TokenExpiredError",
}));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: h.queueAdd }),
  PROFILE_JOB_NAME: "fetch-profile",
}));

import { pt } from "../lib/i18n/pt";
import { translate } from "../lib/i18n";
import {
  needsProfileLookup,
  queueProfileLookup,
  resetProfileQueueCooldown,
} from "../lib/contacts/profile-queue";
import { backfillUsernames } from "../lib/contacts/profile-backfill";
import { contactDisplayName, inboxHref } from "../components/contact-ui";
import { triggerText } from "../components/trigger-ui";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ─── Menu ───────────────────────────────────────────────────────────────────

describe("QA sidebar sections", () => {
  const src = read("components/sidebar.tsx");
  const block = src.slice(src.indexOf("const navSections"), src.indexOf("interface SidebarProps"));
  const titles = [...block.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]);
  const items = [...block.matchAll(/\{ label: "([^"]+)", href: "([^"]+)" \}/g)].map((m) => ({ label: m[1], href: m[2] }));

  it("has the 5 sections, each with a title (Quiz since Etapa 6)", () => {
    expect(titles).toEqual(["Home", "Conversations", "Automations", "Quiz", "Channels and account"]);
  });

  it("lists every top-level dashboard screen once (and only screens that exist)", () => {
    const dir = join(ROOT, "app/(dashboard)");
    const screens = readdirSync(dir)
      .filter((n) => statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, "page.tsx")))
      // /automations only redirects to /campaigns.
      .filter((n) => !read(`app/(dashboard)/${n}/page.tsx`).includes('redirect("/campaigns")'))
      .map((n) => `/${n}`)
      .sort();
    const hrefs = items.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect([...hrefs].sort()).toEqual(screens);
  });

  it("every item keeps its icon", () => {
    for (const { href } of items) expect(src).toContain(`"${href}": ({ ativo })`);
  });

  it("section titles and labels are translated (they go through t() dynamically)", () => {
    const missing = [...titles, ...items.map((i) => i.label)].filter((k) => !(k in pt));
    expect(missing).toEqual([]);
    expect(translate("pt", "Conversations")).not.toBe("Conversations");
    expect(translate("en", "Channels and account")).toBe("Channels and account");
  });

  it("keeps the logo, the language switch, the drafts badge and the mobile drawer", () => {
    expect(src).toContain("<LeadEngineLogo />");
    expect(src).toContain("<LangSwitch />");
    expect(src).toContain('item.href === "/approvals" && pendingDrafts > 0');
    expect(src).toContain('isOpen ? "translate-x-0" : "-translate-x-full"');
    // Tapping an item closes the drawer on the phone.
    expect(src).toContain("onClick={onClose}");
  });
});

// ─── Names on screen ────────────────────────────────────────────────────────

describe("QA contact name fallback", () => {
  const t = (key: string, vars?: Record<string, string | number>) => translate("pt", key, vars);

  it("@ first, then the name, then 'Pessoa do Direct' + end of the ID, never 'Usuário desconhecido'", () => {
    expect(contactDisplayName(t, { username: "fulano", name: "Fulano", igUserId: "123456789" })).toBe("@fulano");
    expect(contactDisplayName(t, { username: "@fulano" })).toBe("@fulano");
    expect(contactDisplayName(t, { username: null, name: " Maria " , igUserId: "1789" })).toBe("Maria");
    const fallback = contactDisplayName(t, { username: null, name: null, igUserId: "17841400001234" });
    expect(fallback).toContain("1234");
    expect(fallback).not.toMatch(/desconhecid|unknown/i);
    expect(contactDisplayName(t, { username: null, name: "   ", igUserId: null })).toBe(translate("pt", "Direct person"));
  });

  it("the open-conversation link is the inbox deep link the Direct screen reads", () => {
    expect(inboxHref("acc 1", "ig&2")).toBe("/inbox?account=acc%201&contact=ig%262");
    const inbox = read("app/(dashboard)/inbox/page.tsx");
    expect(inbox).toContain('query.get("contact")');
    expect(inbox).toContain('query.get("account")');
  });

  it("no screen still shows 'Unknown user'", () => {
    for (const f of [
      "app/(dashboard)/contacts/page.tsx",
      "app/(dashboard)/contacts/[id]/page.tsx",
      "app/(dashboard)/approvals/page.tsx",
      "app/(dashboard)/moderation/page.tsx",
      "app/(dashboard)/inbox/page.tsx",
      "components/messaging-ui.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/Unknown user|Usuário desconhecido|@desconhecido/);
    }
  });

  it("every trigger chip label is translated", () => {
    const shown = [
      { trigger: "COMMENT" as const },
      { trigger: "COMMENT" as const, matchAnyPost: true },
      { trigger: "COMMENT" as const, pendingNextReel: true },
      { trigger: "DM" as const },
      { trigger: "STORY_REPLY" as const },
      { trigger: "STORY_REPLY" as const, storyId: "s1" },
      { trigger: "STORY_MENTION" as const },
      { trigger: "LIVE_COMMENT" as const },
    ].map((c) => triggerText((k: string) => k, c));
    expect(shown.filter((k) => !(k in pt))).toEqual([]);
  });
});

// ─── Profile lookup ─────────────────────────────────────────────────────────

describe("QA profile lookup never holds the webhook", () => {
  /** Every module reachable from a file by its "@/..." and relative imports. */
  function reachable(entry: string): Set<string> {
    const seen = new Set<string>();
    const stack = [entry];
    while (stack.length) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const code = readFileSync(join(ROOT, file), "utf8");
      // Static imports only: dynamic import() is lazy and checked on its own.
      for (const m of code.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gm)) {
        const spec = m[1];
        let base: string | null = null;
        if (spec.startsWith("@/")) base = spec.slice(2);
        else if (spec.startsWith(".")) base = join(file, "..", spec);
        if (!base || base.startsWith("app/generated")) continue;
        const found = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(join(ROOT, p)));
        if (found) stack.push(found);
      }
    }
    return seen;
  }

  it("the webhook route never imports the profile lookup (it only queues it)", () => {
    const graph = reachable("app/api/webhook/route.ts");
    expect(graph.has("lib/contacts/record.ts")).toBe(true);
    expect(graph.has("lib/contacts/profile.ts")).toBe(false);
    expect(graph.has("lib/queue/dm-worker.ts")).toBe(false);
  });

  it("a contact Meta denied is not looked up again on comments, old DMs or within 7 days", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const denied = { username: null, profileStatus: "denied", profileFetchedAt: new Date("2026-10-05T12:00:00Z"), profileAttempts: 1 };
    expect(needsProfileLookup(denied, { type: "COMMENT", occurredAt: now }, now)).toBe(false);
    expect(needsProfileLookup(denied, { type: "DM_IN", occurredAt: new Date("2026-10-05T11:00:00Z") }, now)).toBe(false);
    expect(needsProfileLookup(denied, { type: "DM_IN", occurredAt: now }, now)).toBe(false);
    expect(needsProfileLookup(denied, null, now)).toBe(false);
    // An "ok" lookup that came back without an @ is not retried either.
    expect(needsProfileLookup({ username: null, profileStatus: "ok" }, { type: "DM_IN", occurredAt: now }, now)).toBe(false);
  });

  it("with Redis down, only the first DM of a payload waits for the queue", async () => {
    vi.stubEnv("REDIS_URL", "redis://test");
    resetProfileQueueCooldown();
    h.queueAdd.mockReset();
    h.queueAdd.mockRejectedValue(new Error("ECONNREFUSED"));
    for (let i = 0; i < 5; i++) {
      expect(await queueProfileLookup({ instagramId: "ig_owner", contactId: `ct_${i}` })).toBe(false);
    }
    expect(h.queueAdd).toHaveBeenCalledTimes(1);

    // Back after the cooldown: queues again.
    resetProfileQueueCooldown();
    h.queueAdd.mockResolvedValue({});
    expect(await queueProfileLookup({ instagramId: "ig_owner", contactId: "ct_9" })).toBe(true);
    vi.unstubAllEnvs();
  });

  it("a queue that hangs gives up after 2 s instead of holding the request", async () => {
    vi.useFakeTimers();
    vi.stubEnv("REDIS_URL", "redis://test");
    resetProfileQueueCooldown();
    h.queueAdd.mockReset();
    h.queueAdd.mockReturnValue(new Promise(() => undefined));
    const pending = queueProfileLookup({ instagramId: "ig_owner", contactId: "ct_1" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBe(false);
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetProfileQueueCooldown();
  });
});

// ─── Backfill against an in-memory database ─────────────────────────────────

describe("QA backfill-usernames is idempotent", () => {
  function err(name: string, code: number) {
    const e = new Error(`${name} ${code}`) as Error & { code: number };
    e.name = name;
    e.code = code;
    return e;
  }
  const contact = (id: string, over: Partial<Contact> = {}): Contact => ({
    id,
    igUserId: `ig_${id}`,
    username: null,
    name: null,
    profilePicUrl: null,
    profileStatus: null,
    profileFetchedAt: null,
    profileAttempts: 0,
    instagramAccountId: "acc_row",
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    h.contacts = [
      contact("a"),
      contact("b"),
      contact("c"),
      contact("d", { username: "ja_tem" }),
      contact("e", { profileStatus: "denied", profileAttempts: 1, profileFetchedAt: new Date("2026-09-01") }),
      contact("f"),
    ];
    h.prisma.instagramAccount.findMany.mockResolvedValue([{ id: "acc_row", username: "omatheus.ai" }]);
    h.prisma.contact.findMany.mockImplementation(
      async ({ where, take }: { where: Record<string, unknown>; take: number }) => {
        const statusOk = (s: string | null) => {
          if ("OR" in where) return s === null || s === "denied" || s === "error";
          return s === (where.profileStatus as string | null);
        };
        const gt = (where.id as { gt?: string } | undefined)?.gt;
        return h.contacts
          .filter((c) => c.instagramAccountId === where.instagramAccountId && c.username === null && statusOk(c.profileStatus))
          .filter((c) => !gt || c.id > gt)
          .sort((x, y) => x.id.localeCompare(y.id))
          .slice(0, take)
          .map((c) => ({ id: c.id, igUserId: c.igUserId }));
      }
    );
    h.prisma.contact.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      const c = h.contacts.find((x) => x.id === where.id);
      return c
        ? { ...c, instagramAccount: { id: "acc_row", instagramId: "ig_owner", status: "ACTIVE", accessToken: "enc" } }
        : null;
    });
    h.prisma.contact.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Contact> }) => {
      const c = h.contacts.find((x) => x.id === where.id) as Contact;
      Object.assign(c, data);
      return c;
    });
    h.prisma.contact.updateMany.mockImplementation(async ({ where, data }: { where: { id: string }; data: Partial<Contact> }) => {
      const c = h.contacts.find((x) => x.id === where.id && x.username === null);
      if (c) Object.assign(c, data);
      return { count: c ? 1 : 0 };
    });
    // "f" was seen in a campaign log: no Meta call needed.
    h.prisma.dmLog.findFirst.mockImplementation(async ({ where }: { where: { commenterId: string } }) =>
      where.commenterId === "ig_f" ? { commenterName: "da_campanha" } : null
    );
    h.prisma.commentModeration.findFirst.mockResolvedValue(null);
    h.reserveProfileSlot.mockResolvedValue({ allowed: true, count: 1, retryInMs: 0 });
    h.getUserProfile.mockImplementation(async (_token: string, igsid: string) => {
      if (igsid === "ig_a") return { username: "pessoa_a", name: "Pessoa A", profilePic: "https://cdn/a.jpg" };
      if (igsid === "ig_b") throw err("PermissionError", 10);
      if (igsid === "ig_e") return { username: "pessoa_e", name: null, profilePic: null };
      throw err("MetaApiError", 2);
    });
  });

  it("first run fills, marks denied / error; a second run touches nothing and calls Meta 0 times", async () => {
    const sleep = vi.fn(async () => undefined);
    const first = await backfillUsernames({ batchSize: 2, pauseMs: 1500, sleep });
    expect(first).toMatchObject({ looked: 4, ok: 1, denied: 1, error: 1, local: 1, apiCalls: 3 });
    expect(sleep).toHaveBeenCalledTimes(3);

    const byId = Object.fromEntries(h.contacts.map((c) => [c.id, c]));
    expect(byId.a).toMatchObject({ username: "pessoa_a", name: "Pessoa A", profilePicUrl: "https://cdn/a.jpg", profileStatus: "ok", profileAttempts: 1 });
    expect(byId.b).toMatchObject({ username: null, profileStatus: "denied", profileAttempts: 1 });
    expect(byId.c).toMatchObject({ username: null, profileStatus: "error", profileAttempts: 1 });
    expect(byId.d.username).toBe("ja_tem");
    expect(byId.e.profileStatus).toBe("denied"); // not retried without --retry-denied
    expect(byId.f).toMatchObject({ username: "da_campanha", profileStatus: "ok" });

    h.getUserProfile.mockClear();
    const second = await backfillUsernames({ batchSize: 2, pauseMs: 1500, sleep });
    expect(second).toMatchObject({ looked: 0, apiCalls: 0 });
    expect(h.getUserProfile).not.toHaveBeenCalled();
    // Nothing is ever deleted.
    expect(h.contacts).toHaveLength(6);
  });

  it("--retry-denied gives the denied / failed ones one more try, and only them", async () => {
    await backfillUsernames({ sleep: vi.fn() });
    h.getUserProfile.mockClear();
    const retry = await backfillUsernames({ retryDenied: true, sleep: vi.fn() });
    expect(retry.looked).toBe(3); // b, c, e
    expect(h.getUserProfile.mock.calls.map((c) => c[1]).sort()).toEqual(["ig_b", "ig_c", "ig_e"]);
    expect(h.contacts.find((c) => c.id === "e")?.username).toBe("pessoa_e");
    expect(h.contacts.find((c) => c.id === "b")?.profileAttempts).toBe(2);
  });

  it("--dry-run changes nothing and calls Meta 0 times", async () => {
    const before = JSON.stringify(h.contacts);
    const stats = await backfillUsernames({ dryRun: true, sleep: vi.fn() });
    expect(stats).toMatchObject({ looked: 4, local: 1, needs_api: 3, apiCalls: 0 });
    expect(h.getUserProfile).not.toHaveBeenCalled();
    expect(JSON.stringify(h.contacts)).toBe(before);
  });
});
