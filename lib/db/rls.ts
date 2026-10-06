/**
 * Fase 0 (06/10/2026): RLS no Postgres, a segunda tranca além do filtro por
 * workspaceId que o código já faz.
 *
 * Toda consulta feita por aqui roda numa transação curta que começa marcando
 * quem é a pessoa e qual o workspace ativo:
 *
 *   SELECT set_config('app.user_id', ..., true),
 *          set_config('app.workspace_id', ..., true),
 *          set_config('role', 'le_app', true)
 *
 * O `true` faz o valor valer só dentro daquela transação, então funciona com o
 * pool de conexões e nunca "vaza" pra outra requisição. Trocar o papel pra
 * le_app (sem BYPASSRLS) faz a RLS valer mesmo quando a conexão do
 * DATABASE_URL é dona das tabelas ou superusuária.
 *
 * Quem usa: as tabelas novas do schema whatsapp e o log de auditoria do admin.
 * As tabelas antigas continuam no cliente de sempre (lib/db/client.ts) até a
 * RLS chegar nelas, uma por uma (docs/fase0-multiusuario.md).
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/db/client";

export type RlsContext = {
  userId: string;
  /** Workspace ativo (o da sessão, ou o da chave de API). null = nenhum. */
  workspaceId: string | null;
  /** Registro de AdminAccessLog que libera o admin a ler conteúdo (ver adminRead). */
  adminAccessId?: string | null;
};

type TxClient = Prisma.TransactionClient;

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Papel que a transação assume. DB_RLS_ROLE=off desliga a troca (use só se a
 * conexão DATABASE_URL_APP já for um usuário sem BYPASSRLS).
 */
export function rlsRole(env: Record<string, string | undefined> = process.env): string | null {
  const value = (env.DB_RLS_ROLE ?? "le_app").trim();
  if (!value || value === "off") return null;
  if (!ROLE_NAME.test(value)) throw new Error("DB_RLS_ROLE inválido");
  return value;
}

/**
 * O comando que abre cada transação. Exportado pra teste. Sem papel
 * (DB_RLS_ROLE=off), 'none' mantém o papel da própria conexão.
 */
export function rlsStatement(ctx: RlsContext, role: string | null = rlsRole()): Prisma.Sql {
  if (!ctx.userId) throw new Error("RLS sem usuário");
  return Prisma.sql`SELECT set_config('app.user_id', ${ctx.userId}, true),
    set_config('app.workspace_id', ${ctx.workspaceId ?? ""}, true),
    set_config('app.admin_access_id', ${ctx.adminAccessId ?? ""}, true),
    set_config('role', ${role ?? "none"}, true)`;
}

const globalForRls = globalThis as unknown as { prismaApp?: PrismaClient };

/**
 * Cliente do papel da aplicação. Com DATABASE_URL_APP usa uma conexão própria
 * (usuário le_app com senha); sem ela, a mesma conexão de sempre, trocando o
 * papel em cada transação.
 */
export function getAppPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL_APP;
  if (!url) return getPrisma();
  if (!globalForRls.prismaApp) {
    globalForRls.prismaApp = new PrismaClient({ adapter: new PrismaPg(url) });
  }
  return globalForRls.prismaApp;
}

/** Marca o contexto numa transação já aberta (ex.: depois de gravar a auditoria). */
export async function applyContext(tx: TxClient, ctx: RlsContext): Promise<void> {
  await tx.$executeRaw(rlsStatement(ctx));
}

/**
 * Roda `fn` numa transação com a RLS marcada pra essa pessoa e esse workspace.
 * Use pra várias consultas seguidas (todas veem o mesmo contexto).
 */
export async function withRls<T>(
  ctx: RlsContext,
  fn: (tx: TxClient) => Promise<T>,
  base: PrismaClient = getAppPrisma()
): Promise<T> {
  return base.$transaction(async (tx) => {
    await applyContext(tx, ctx);
    return fn(tx);
  });
}

/**
 * Cliente estendido (extensão do Prisma): cada consulta vira uma transação
 * curta [marca o contexto, consulta]. Mesmo desenho do exemplo oficial de RLS
 * do Prisma.
 */
export function forUser(ctx: RlsContext, base: PrismaClient = getAppPrisma()) {
  const statement = rlsStatement(ctx);
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await base.$transaction([base.$executeRaw(statement), query(args)]);
          return result;
        },
      },
    },
  });
}

/**
 * Serviço do sistema (webhook, cron, worker antes de saber de quem é o
 * evento): assume le_system, que tem BYPASSRLS. Código pequeno e revisado.
 */
export async function withSystemRole<T>(
  fn: (tx: TxClient) => Promise<T>,
  base: PrismaClient = getPrisma(),
  env: Record<string, string | undefined> = process.env
): Promise<T> {
  const role = (env.DB_SYSTEM_ROLE ?? "le_system").trim();
  return base.$transaction(async (tx) => {
    if (role && role !== "off") {
      if (!ROLE_NAME.test(role)) throw new Error("DB_SYSTEM_ROLE inválido");
      await tx.$executeRaw`SELECT set_config('role', ${role}, true)`;
    }
    return fn(tx);
  });
}
