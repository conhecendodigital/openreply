/**
 * Fase 0 (06/10/2026): liga os usuários que já existem ao login novo, sem
 * apagar nada. Pode rodar quantas vezes quiser (idempotente):
 *
 * 1. e-mail com maiúscula ou espaço vira minúsculo (o login novo procura em
 *    minúsculo; sem isso nasceria uma conta nova e vazia). Se já existir outro
 *    usuário com o mesmo e-mail, não mexe e avisa;
 * 2. quem já confirmou o e-mail no NextAuth (emailVerified com data) fica com
 *    authEmailVerified = true;
 * 3. os e-mails de admin viram role = ADMIN (nunca rebaixa ninguém);
 * 4. ALLOWED_EMAILS e os admins entram na BetaAllowlist.
 *
 * Os IDs da tabela User não mudam, então workspace, campanhas, quizzes,
 * contatos, chaves de API e convites continuam apontando certo. As tabelas do
 * NextAuth (Account, Session, VerificationToken) não são tocadas.
 *
 * Fala SQL puro por uma função `query`, pra rodar igual no Postgres de verdade
 * (pg) e no PGlite dos testes.
 */
export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export type MigrationOptions = {
  apply: boolean;
  adminEmails: string[];
  allowedEmails: string[];
};

export type MigrationReport = {
  apply: boolean;
  emailsLowercased: string[];
  emailConflicts: string[];
  verifiedMarked: number;
  adminsPromoted: string[];
  adminsMissing: string[];
  allowlistAdded: string[];
  counts: Record<string, number>;
};

/** Tabelas que têm de ficar com o mesmo número de linhas antes e depois. */
export const KEPT_TABLES = [
  "User",
  "Workspace",
  "WorkspaceMember",
  "WorkspaceInvitation",
  "ApiToken",
  "InstagramAccount",
  "Automation",
  "Contact",
  "Funnel",
  "Account",
  "Session",
] as const;

export function parseEmailList(value: string | undefined | null): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@"))
    ),
  ];
}

export async function countKeptTables(query: Query): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of KEPT_TABLES) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM public."${table}"`);
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

export async function migrateLoginData(query: Query, opts: MigrationOptions): Promise<MigrationReport> {
  const report: MigrationReport = {
    apply: opts.apply,
    emailsLowercased: [],
    emailConflicts: [],
    verifiedMarked: 0,
    adminsPromoted: [],
    adminsMissing: [],
    allowlistAdded: [],
    counts: await countKeptTables(query),
  };

  // 1. E-mails fora do padrão.
  const odd = await query(
    `SELECT id, email FROM public."User" WHERE email IS NOT NULL AND email <> lower(trim(email)) ORDER BY "createdAt"`
  );
  for (const row of odd.rows) {
    const id = String(row.id);
    const email = String(row.email);
    const target = email.trim().toLowerCase();
    const clash = await query(`SELECT id FROM public."User" WHERE lower(trim(email)) = $1 AND id <> $2 LIMIT 1`, [target, id]);
    if (clash.rows.length) {
      report.emailConflicts.push(email);
      continue;
    }
    report.emailsLowercased.push(`${email} -> ${target}`);
    if (opts.apply) await query(`UPDATE public."User" SET email = $1 WHERE id = $2`, [target, id]);
  }

  // 2. E-mail já confirmado no NextAuth.
  const pending = await query(
    `SELECT count(*)::int AS n FROM public."User" WHERE "emailVerified" IS NOT NULL AND "authEmailVerified" = false`
  );
  report.verifiedMarked = Number(pending.rows[0]?.n ?? 0);
  if (opts.apply && report.verifiedMarked) {
    await query(`UPDATE public."User" SET "authEmailVerified" = true WHERE "emailVerified" IS NOT NULL AND "authEmailVerified" = false`);
  }

  // 3. Admins.
  for (const email of opts.adminEmails) {
    const { rows } = await query(`SELECT id, role FROM public."User" WHERE lower(trim(email)) = $1`, [email]);
    if (!rows.length) {
      report.adminsMissing.push(email);
      continue;
    }
    for (const row of rows) {
      if (row.role === "ADMIN") continue;
      report.adminsPromoted.push(email);
      if (opts.apply) await query(`UPDATE public."User" SET role = 'ADMIN' WHERE id = $1`, [row.id]);
    }
  }

  // 4. Allowlist do beta.
  for (const email of [...new Set([...opts.adminEmails, ...opts.allowedEmails])]) {
    const { rows } = await query(`SELECT email FROM public."BetaAllowlist" WHERE email = $1`, [email]);
    if (rows.length) continue;
    report.allowlistAdded.push(email);
    if (opts.apply) {
      await query(
        `INSERT INTO public."BetaAllowlist"(email, note) VALUES ($1, 'migração fase 0') ON CONFLICT (email) DO NOTHING`,
        [email]
      );
    }
  }

  return report;
}
