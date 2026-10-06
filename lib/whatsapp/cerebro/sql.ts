/**
 * Executor de SQL do cérebro.
 *
 * O cérebro fala SQL cru (pgvector não tem tipo no Prisma) por esta interface
 * pequena, que os testes trocam por um falso. A implementação com Prisma abre
 * uma transação curta e marca `app.user_id` (o mesmo truque do `dbAs()` do
 * plano), então a RLS por workspace vale em toda consulta.
 *
 * Quando juntar com a Fase 0: troque o `prisma` passado aqui pelo cliente do
 * papel le_app (`prismaApp`). O resto não muda.
 */

export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Várias consultas na mesma transação (tudo ou nada). */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** O pedaço do PrismaClient que o executor usa. */
export interface PrismaRawLike {
  $queryRawUnsafe<T = unknown>(sql: string, ...params: unknown[]): Promise<T>;
  $transaction<T>(fn: (tx: PrismaRawLike) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T>;
}

export interface PrismaExecutorOptions {
  /** Usuário dono da requisição ou do job (vira app.user_id na RLS). */
  userId: string;
  /** Configurações locais extras da transação (ex.: hnsw.ef_search). */
  settings?: Record<string, string>;
  timeoutMs?: number;
}

async function applySettings(tx: PrismaRawLike, userId: string, settings: Record<string, string> = {}) {
  await tx.$queryRawUnsafe("SELECT set_config('app.user_id', $1, true)", userId);
  for (const [name, value] of Object.entries(settings)) {
    if (!/^[a-z_]+(\.[a-z_]+)?$/.test(name)) throw new Error("Nome de configuração inválido");
    await tx.$queryRawUnsafe("SELECT set_config($1, $2, true)", name, value);
  }
}

export function createPrismaSqlExecutor(prisma: PrismaRawLike, options: PrismaExecutorOptions): SqlExecutor {
  const timeout = options.timeoutMs ?? 30_000;

  const inTx = (tx: PrismaRawLike): SqlExecutor => ({
    query: <T>(sql: string, params: unknown[] = []) => tx.$queryRawUnsafe<T[]>(sql, ...params),
    // Já estamos numa transação: reaproveita.
    transaction: (fn) => fn(inTx(tx)),
  });

  return {
    query<T>(sql: string, params: unknown[] = []) {
      return prisma.$transaction(async (tx) => {
        await applySettings(tx, options.userId, options.settings);
        return tx.$queryRawUnsafe<T[]>(sql, ...params);
      }, { timeout });
    },
    transaction(fn) {
      return prisma.$transaction(async (tx) => {
        await applySettings(tx, options.userId, options.settings);
        return fn(inTx(tx));
      }, { timeout });
    },
  };
}
