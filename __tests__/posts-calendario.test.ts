/**
 * Calendário da aba Posts (28/10/2026): grade do mês, fuso de Brasília, agrupamento por dia,
 * próximo horário livre, recusa de passado, parâmetros novos de GET /api/posts e render básico.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => {
  const models = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const model = (name: string) => {
    if (!models.has(name)) {
      models.set(
        name,
        new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
          get(target, method: string) {
            if (!target[method]) target[method] = vi.fn(async () => null);
            return target[method];
          },
        })
      );
    }
    return models.get(name)!;
  };
  const prisma = new Proxy({} as Record<string, unknown>, { get: (_t, name: string) => model(name) });
  return { prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>, models, mockContext: vi.fn() };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: vi.fn() }));

import {
  addDays,
  dayKey,
  dayProblem,
  groupByDay,
  monthGrid,
  moveToDay,
  nextFreeSlot,
  shiftMonth,
  slotIso,
  soonestTime,
  timeOf,
  timeProblem,
  undatedDrafts,
  visibleRange,
  weekDays,
  weekdayOf,
} from "../lib/posts/calendar";
import { parseListQuery } from "../lib/posts/list-query";
import * as postsRoute from "../app/api/posts/route";
import { PostCalendar } from "../components/posts/post-calendar";

const post = (over: Record<string, unknown>) =>
  ({ id: "p", status: "SCHEDULED", scheduledAt: null, publishedAt: null, updatedAt: "2026-10-01T00:00:00.000Z", ...over }) as never;

describe("grade do mês (domingo primeiro)", () => {
  it("fevereiro de 2026 (28 dias, começa no domingo) tem 4 semanas certinhas", () => {
    const g = monthGrid(2026, 2);
    expect(g).toHaveLength(4);
    expect(g[0][0]).toMatchObject({ key: "2026-02-01", inMonth: true });
    expect(g[3][6]).toMatchObject({ key: "2026-02-28", inMonth: true });
    expect(g.flat().every((c) => c.inMonth)).toBe(true);
  });

  it("abril de 2026 (30 dias): dias de março completam a 1ª semana", () => {
    const g = monthGrid(2026, 4);
    expect(g).toHaveLength(5);
    expect(g[0][0]).toMatchObject({ key: "2026-03-29", inMonth: false });
    expect(g[0][3]).toMatchObject({ key: "2026-04-01", inMonth: true });
    expect(g[4][4]).toMatchObject({ key: "2026-04-30", inMonth: true });
    expect(g[4][5].inMonth).toBe(false);
  });

  it("outubro de 2026 (31 dias, começa na quinta) tem 5 semanas; agosto de 2026 precisa de 6", () => {
    expect(monthGrid(2026, 10)).toHaveLength(5);
    expect(monthGrid(2026, 10)[0][4].key).toBe("2026-10-01");
    expect(monthGrid(2026, 8)).toHaveLength(6);
  });

  it("ano bissexto: fevereiro de 2028 tem o dia 29", () => {
    expect(monthGrid(2028, 2).flat().filter((c) => c.inMonth)).toHaveLength(29);
  });

  it("dia da semana vem da data (29/10/2026 é quinta), toda coluna 0 é domingo", () => {
    expect(weekdayOf("2026-10-29")).toBe(4);
    for (const row of monthGrid(2026, 11)) expect(weekdayOf(row[0].key)).toBe(0);
    expect(weekDays("2026-10-29").map((c) => c.key)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  });

  it("navega entre meses e virada de ano; intervalo é o mês ±7 dias", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(visibleRange(2026, 10)).toEqual({ from: "2026-09-24T03:00:00.000Z", to: "2026-11-08T03:00:00.000Z" });
  });
});

describe("fuso de Brasília", () => {
  it("21h de Brasília já é o dia seguinte em UTC, mas o post fica no dia de Brasília", () => {
    expect(dayKey("2026-10-30T00:30:00.000Z")).toBe("2026-10-29");
    expect(timeOf("2026-10-30T00:30:00.000Z")).toBe("21:30");
    expect(dayKey("2026-10-29T02:59:00.000Z")).toBe("2026-10-28");
    expect(dayKey("2026-10-29T03:00:00.000Z")).toBe("2026-10-29");
  });

  it("slotIso converte hora de Brasília para UTC; entrada inválida vira null", () => {
    expect(slotIso("2026-10-29", "20:30")).toBe("2026-10-29T23:30:00.000Z");
    expect(slotIso("2026-13-40", "12:00")).toBeNull();
    expect(slotIso("2026-10-29", "9:00")).toBeNull();
  });

  it("mover para outro dia mantém a hora de Brasília", () => {
    expect(moveToDay("2026-10-29T23:30:00.000Z", "2026-11-02")).toBe("2026-11-02T23:30:00.000Z");
  });
});

describe("agrupar por dia", () => {
  it("agrupa pelo dia de Brasília, ordena por hora, usa publishedAt nos publicados e ignora rascunho sem data e cancelado", () => {
    const map = groupByDay([
      post({ id: "b", scheduledAt: "2026-10-29T23:30:00.000Z" }),
      post({ id: "a", scheduledAt: "2026-10-29T15:00:00.000Z" }),
      post({ id: "c", status: "PUBLISHED", scheduledAt: "2026-10-01T15:00:00.000Z", publishedAt: "2026-10-30T00:10:00.000Z" }),
      post({ id: "d", status: "DRAFT" }),
      post({ id: "e", status: "CANCELED", scheduledAt: "2026-10-29T15:00:00.000Z" }),
    ]);
    expect(map.get("2026-10-29")?.map((p: { id: string }) => p.id)).toEqual(["a", "b", "c"]);
    expect(map.size).toBe(1);
  });

  it("rascunhos sem data vão para a faixa, os mais novos primeiro", () => {
    const list = undatedDrafts([
      post({ id: "1", status: "DRAFT", updatedAt: "2026-10-01T00:00:00.000Z" }),
      post({ id: "2", status: "DRAFT", updatedAt: "2026-10-05T00:00:00.000Z" }),
      post({ id: "3", status: "DRAFT", scheduledAt: "2026-10-09T00:00:00.000Z" }),
      post({ id: "4", status: "SCHEDULED", scheduledAt: "2026-10-09T00:00:00.000Z" }),
    ]);
    expect(list.map((p: { id: string }) => p.id)).toEqual(["2", "1"]);
  });
});

describe("horário sugerido e passado", () => {
  const NOW = new Date("2026-10-28T13:00:00.000Z"); // 10:00 em Brasília

  it("dia futuro livre sugere 12:00; ocupado pula para 17:00 e depois 20:30", () => {
    expect(nextFreeSlot("2026-10-30", [], NOW)).toBe("12:00");
    expect(nextFreeSlot("2026-10-30", ["2026-10-30T15:00:00.000Z"], NOW)).toBe("17:00");
    expect(nextFreeSlot("2026-10-30", ["2026-10-30T15:00:00.000Z", "2026-10-30T20:00:00.000Z"], NOW)).toBe("20:30");
  });

  it("tudo ocupado devolve o primeiro; horário de outro dia não conta como ocupado", () => {
    const all = ["2026-10-30T15:00:00.000Z", "2026-10-30T20:00:00.000Z", "2026-10-30T23:30:00.000Z"];
    expect(nextFreeSlot("2026-10-30", all, NOW)).toBe("12:00");
    expect(nextFreeSlot("2026-10-30", ["2026-10-29T15:00:00.000Z"], NOW)).toBe("12:00");
  });

  it("hoje pula o que já passou (precisa de agora + 60 s) e devolve null quando acabou", () => {
    expect(nextFreeSlot("2026-10-28", [], NOW)).toBe("12:00");
    expect(nextFreeSlot("2026-10-28", [], new Date("2026-10-28T14:59:30.000Z"))).toBe("17:00"); // 11:59:30, falta menos de 60 s
    expect(nextFreeSlot("2026-10-28", [], new Date("2026-10-29T00:00:00.000Z"))).toBeNull(); // 21:00
    expect(soonestTime(new Date("2026-10-29T00:00:00.000Z"))).toBe("21:05");
  });

  it("dia passado é recusado; hoje e futuro não", () => {
    expect(dayProblem("2026-10-27", NOW)).toBe("past_day");
    expect(dayProblem("2026-10-28", NOW)).toBeNull();
    expect(dayProblem("2026-10-29", NOW)).toBeNull();
  });

  it("horário vale com folga de 60 s, igual ao /schedule", () => {
    expect(timeProblem("2026-10-28T13:00:59.000Z", NOW)).toBe("past_time");
    expect(timeProblem("2026-10-28T13:01:00.000Z", NOW)).toBeNull();
    expect(timeProblem(null, NOW)).toBe("past_time");
  });
});

describe("GET /api/posts com from/to/limit", () => {
  const req = (qs: string) => new NextRequest(`http://localhost/api/posts${qs}`);
  beforeEach(() => {
    vi.clearAllMocks();
    h.models.clear();
    h.mockContext.mockResolvedValue({ userId: "u", workspaceId: "ws_A", role: "OWNER" });
    h.prisma.scheduledPost.findMany.mockResolvedValue([]);
  });

  it("sem parâmetros novos continua igual: workspace, take 200", async () => {
    expect((await postsRoute.GET(req(""))).status).toBe(200);
    const args = h.prisma.scheduledPost.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ workspaceId: "ws_A" });
    expect(args.take).toBe(200);
  });

  it("intervalo filtra por scheduledAt ou publishedAt, sempre dentro do workspace, e respeita limit", async () => {
    const res = await postsRoute.GET(req("?from=2026-09-24T03:00:00.000Z&to=2026-11-08T03:00:00.000Z&limit=500&status=SCHEDULED"));
    expect(res.status).toBe(200);
    const args = h.prisma.scheduledPost.findMany.mock.calls[0][0];
    expect(args.where.workspaceId).toBe("ws_A");
    expect(args.where.status).toBe("SCHEDULED");
    expect(args.where.OR).toHaveLength(2);
    expect(args.where.OR[0].scheduledAt.gte.toISOString()).toBe("2026-09-24T03:00:00.000Z");
    expect(args.where.OR[0].scheduledAt.lt.toISOString()).toBe("2026-11-08T03:00:00.000Z");
    expect(args.take).toBe(500);
  });

  it("recusa data inválida, só um lado, janela enorme e limit fora da faixa (sem consultar o banco)", async () => {
    for (const qs of ["?from=ontem&to=hoje", "?from=2026-10-01", "?from=2026-10-10&to=2026-10-01", "?from=2026-01-01&to=2026-12-31", "?limit=0", "?limit=501", "?limit=abc"]) {
      const res = await postsRoute.GET(req(qs));
      expect(res.status, qs).toBe(400);
    }
    expect(h.prisma.scheduledPost.findMany).not.toHaveBeenCalled();
  });

  it("sem sessão devolve a resposta de auth e não consulta", async () => {
    h.mockContext.mockResolvedValue(null);
    const res = await postsRoute.GET(req("?from=2026-10-01&to=2026-10-30"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.prisma.scheduledPost.findMany).not.toHaveBeenCalled();
  });

  it("parseListQuery aceita data simples como meia-noite de Brasília", () => {
    const q = parseListQuery(new URLSearchParams("from=2026-10-01&to=2026-10-31"));
    expect(q.ok && q.from?.toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

describe("render básico do calendário", () => {
  it("mostra a grade em pt-BR com os dias da semana vindos do Intl e os botões de navegação", () => {
    const html = renderToStaticMarkup(createElement(PostCalendar, { reloadToken: 0, canCreate: true, onCreate: () => {}, onEdit: () => {}, onChanged: () => {} }));
    expect(html).toContain('role="grid"');
    expect(html).toContain("Calendário");
    expect(html).toContain("dom");
    expect(html).toContain("Mês anterior");
    expect(html).toContain("Agendar um post em");
    expect(html).toContain("Horários de Brasília.");
  });
});
