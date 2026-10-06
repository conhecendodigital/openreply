/**
 * Fase 0 (06/10/2026): liga os usuários que já existem ao login novo
 * (Better Auth). Não apaga nada e pode rodar de novo sem efeito colateral.
 * Detalhes em lib/auth-data-migration.ts e docs/fase0-multiusuario.md.
 *
 *   npx tsx scripts/migrar-login-better-auth.ts --admin=voce@email.com            # simulação (padrão)
 *   npx tsx scripts/migrar-login-better-auth.ts --admin=voce@email.com --aplicar  # grava
 *
 * Sem --admin, usa ADMIN_EMAILS. A allowlist do beta recebe o ALLOWED_EMAILS.
 * Rode DEPOIS do `prisma migrate deploy` (as colunas novas precisam existir).
 */
import { Pool } from "pg";
import { countKeptTables, migrateLoginData, parseEmailList } from "@/lib/auth-data-migration";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--aplicar");
  const adminArg = args.find((a) => a.startsWith("--admin="))?.split("=")[1];
  const adminEmails = parseEmailList(adminArg ?? process.env.ADMIN_EMAILS);
  const allowedEmails = parseEmailList(process.env.ALLOWED_EMAILS);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurado.");
  if (!adminEmails.length) {
    console.log("[login] Aviso: nenhum admin (--admin=email ou ADMIN_EMAILS). Ninguém vira ADMIN nesta rodada.");
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const query = (sql: string, params?: unknown[]) => pool.query(sql, params as unknown[]);
  try {
    const report = await migrateLoginData(query, { apply, adminEmails, allowedEmails });
    const after = await countKeptTables(query);
    console.log(`[login] ${apply ? "GRAVADO" : "SIMULAÇÃO (nada gravado, use --aplicar)"}`);
    console.log(`[login] e-mails em minúsculo: ${report.emailsLowercased.length ? report.emailsLowercased.join(", ") : "nenhum"}`);
    if (report.emailConflicts.length) {
      console.log(`[login] ATENÇÃO, e-mail duplicado (não mexi, resolva à mão): ${report.emailConflicts.join(", ")}`);
    }
    console.log(`[login] e-mails já confirmados marcados no login novo: ${report.verifiedMarked}`);
    console.log(`[login] viram ADMIN: ${report.adminsPromoted.join(", ") || "nenhum (já eram ou não há)"}`);
    if (report.adminsMissing.length) console.log(`[login] admin sem usuário no banco: ${report.adminsMissing.join(", ")}`);
    console.log(`[login] entram na allowlist do beta: ${report.allowlistAdded.join(", ") || "nenhum (já estavam)"}`);
    console.log("[login] linhas por tabela (antes = depois, nada apagado):");
    for (const [table, n] of Object.entries(report.counts)) {
      const ok = after[table] === n ? "ok" : `MUDOU pra ${after[table]}`;
      console.log(`  ${table}: ${n} (${ok})`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[login] falhou:", error instanceof Error ? error.message : error);
  process.exit(1);
});
