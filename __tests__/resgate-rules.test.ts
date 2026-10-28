/** Resgatar comentários: regras puras (filtros, 7 dias, 1 por pessoa, grafia, ritmo, erros). */
import { describe, expect, it } from "vitest";
import {
  PACE_DEFAULT,
  classifyComments,
  classifyFailure,
  editDistance,
  hourlyPauseMs,
  nextDelayMs,
  normalizePace,
  parsePostRef,
  sameWordWithTypo,
  type ClassifyInput,
  type RawComment,
} from "../lib/resgate/rules";
import { decideFlowOutcome } from "../lib/resgate/service";

const NOW = new Date("2026-10-28T15:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const c = (id: string, user: string, text: string, hours = 24, extra: Partial<RawComment> = {}): RawComment => ({
  id,
  text,
  timestamp: ago(hours),
  from: { id: user, username: `u_${user}` },
  ...extra,
});

function run(comments: RawComment[], over: Partial<ClassifyInput> = {}) {
  return classifyComments({
    comments,
    ownIgUserIds: ["me"],
    now: NOW,
    trigger: { matchAnyWord: false, keywords: ["gemini"], wholeWordMatch: true },
    servedCommentIds: new Set(),
    servedPersonIds: new Set(),
    optOutPersonIds: new Set(),
    takeoverPersonIds: new Set(),
    moderatedCommentIds: new Set(),
    ...over,
  });
}

describe("classifyComments", () => {
  it("só entra quem casa com a palavra do gatilho e conta o resto", () => {
    const r = run([c("1", "a", "Gemini"), c("2", "b", "adorei o vídeo"), c("3", "c", "quero GEMINI!")]);
    expect(r.candidates.map((x) => x.commentId).sort()).toEqual(["1", "3"]);
    expect(r.counts).toMatchObject({ lidos: 3, naoCasamComOGatilho: 1, elegiveis: 2 });
  });

  it("matchAnyWord leva todos", () => {
    const r = run([c("1", "a", "oi"), c("2", "b", "valeu")], { trigger: { matchAnyWord: true, keywords: [], wholeWordMatch: true } });
    expect(r.counts.elegiveis).toBe(2);
    expect(r.candidates[0].matchedBy).toBe("qualquer");
  });

  it("descarta comentário da própria conta e resposta dentro de comentário", () => {
    const r = run([c("1", "me", "Gemini"), c("2", "b", "Gemini", 24, { parent_id: "x" }), c("3", "d", "Gemini")]);
    expect(r.counts).toMatchObject({ proprios: 1, respostasADecomentario: 1, elegiveis: 1 });
  });

  it("comentário com mais de 7 dias é vencido, e o limite tem margem de segurança", () => {
    const r = run([c("old", "a", "Gemini", 24 * 7 + 1), c("edge", "b", "Gemini", 24 * 7 - 0.05), c("ok", "c", "Gemini", 24 * 6)]);
    expect(r.counts.vencidos).toBe(2);
    expect(r.candidates.map((x) => x.commentId)).toEqual(["ok"]);
  });

  it("idempotência: comentário e pessoa que já receberam ficam fora", () => {
    const r = run([c("1", "a", "Gemini"), c("2", "b", "Gemini"), c("3", "c", "Gemini")], {
      servedCommentIds: new Set(["1"]),
      servedPersonIds: new Set(["b"]),
    });
    expect(r.counts).toMatchObject({ jaAtendidosPorComentario: 1, jaAtendidosPorPessoa: 1, elegiveis: 1 });
    expect(r.candidates[0].commentId).toBe("3");
  });

  it("1 DM por pessoa: dois comentários da mesma pessoa viram um (o mais novo)", () => {
    const r = run([c("1", "a", "Gemini", 48), c("2", "a", "Gemini", 5)]);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].commentId).toBe("2");
    expect(r.counts.pessoaRepetida).toBe(1);
  });

  it("opt-out, atendimento humano e comentário escondido pela moderação ficam fora", () => {
    const r = run([c("1", "a", "Gemini"), c("2", "b", "Gemini"), c("3", "c", "Gemini"), c("4", "d", "Gemini")], {
      optOutPersonIds: new Set(["a"]),
      takeoverPersonIds: new Set(["b"]),
      moderatedCommentIds: new Set(["3"]),
    });
    expect(r.counts).toMatchObject({ optOut: 1, assumidosPorHumano: 1, moderados: 1, elegiveis: 1 });
    expect(r.candidates[0].igUserId).toBe("d");
  });

  it("desde corta o que veio antes", () => {
    const r = run([c("1", "a", "Gemini", 100), c("2", "b", "Gemini", 10)], { since: new Date(NOW.getTime() - 50 * 3_600_000) });
    expect(r.counts.antesDoDesde).toBe(1);
    expect(r.candidates).toHaveLength(1);
  });

  it("grafia errada só entra com tolerarGrafia ou palavra extra, e fica marcada", () => {
    const list = [c("1", "a", "Gmani"), c("2", "b", "Geminni"), c("3", "c", "gostei")];
    expect(run(list).counts.elegiveis).toBe(0);
    const typo = run(list, { trigger: { matchAnyWord: false, keywords: ["gemini"], wholeWordMatch: true, tolerateTypos: true } });
    expect(typo.candidates.map((x) => x.commentId).sort()).toEqual(["1", "2"]);
    expect(typo.counts.elegiveisPorGrafia).toBe(2);
    const extra = run(list, { trigger: { matchAnyWord: false, keywords: ["gemini"], wholeWordMatch: true, extraWords: ["gmani"] } });
    expect(extra.candidates.map((x) => x.matchedBy)).toEqual(["extra"]);
  });

  it("ordena do mais antigo (vence primeiro) pro mais novo", () => {
    const r = run([c("n", "a", "Gemini", 2), c("o", "b", "Gemini", 100)]);
    expect(r.candidates.map((x) => x.commentId)).toEqual(["o", "n"]);
  });
});

describe("grafia", () => {
  it("distância de edição e palavras curtas", () => {
    expect(editDistance("gmani", "gemini")).toBe(2);
    expect(editDistance("abc", "xyzxyz", 2)).toBeGreaterThan(2);
    expect(sameWordWithTypo("quero o geminni", ["gemini"])).toBe(true);
    expect(sameWordWithTypo("gato", ["gemini"])).toBe(false);
    expect(sameWordWithTypo("oi", ["ia"])).toBe(false);
  });
});

describe("post", () => {
  it("entende link, shortcode e id", () => {
    expect(parsePostRef("https://www.instagram.com/reel/De0mG9WO7kT/?igsh=1")).toEqual({ shortcode: "De0mG9WO7kT" });
    expect(parsePostRef("https://www.instagram.com/omatheus.ai/reel/De0mG9WO7kT/")).toEqual({ shortcode: "De0mG9WO7kT" });
    expect(parsePostRef("17912345678901234")).toEqual({ mediaId: "17912345678901234" });
    expect(parsePostRef("De0mG9WO7kT")).toEqual({ shortcode: "De0mG9WO7kT" });
    expect(parsePostRef("")).toBeNull();
  });
});

describe("ritmo", () => {
  it("padrão 2-4 s e 400/h, com piso e teto de segurança", () => {
    expect(normalizePace({})).toEqual(PACE_DEFAULT);
    expect(normalizePace({ intervaloMinSegundos: 0.1, tetoPorHora: 99999 })).toMatchObject({ intervaloMinMs: 1500, tetoHora: 600 });
    expect(normalizePace({ intervaloMinSegundos: 10, intervaloMaxSegundos: 5 }).intervaloMaxMs).toBe(10_000);
  });

  it("o intervalo sorteado fica dentro da faixa", () => {
    expect(nextDelayMs(PACE_DEFAULT, () => 0)).toBe(2000);
    expect(nextDelayMs(PACE_DEFAULT, () => 0.999999)).toBe(4000);
  });

  it("passou do teto da hora: espera até liberar a vaga mais antiga", () => {
    const now = 10_000_000;
    const sent = Array.from({ length: 3 }, (_, i) => now - 600_000 + i * 1000);
    expect(hourlyPauseMs(sent, 5, now)).toBe(0);
    const wait = hourlyPauseMs(sent, 3, now);
    expect(wait).toBeGreaterThan(2_900_000);
    expect(wait).toBeLessThanOrEqual(3_000_000 + 1_000);
  });
});

describe("erros", () => {
  it("classifica", () => {
    expect(classifyFailure("Meta API Error 4: limit").kind).toBe("rate_limit");
    expect(classifyFailure("Meta API Error 613: calls").kind).toBe("rate_limit");
    expect(classifyFailure("Meta API Error 100: The comment is invalid for a private reply").kind).toBe("definitivo");
    expect(classifyFailure("window_closed").kind).toBe("fora_da_janela");
    expect(classifyFailure("maybe_sent").kind).toBe("talvez_entregue");
    expect(classifyFailure("channel_off").kind).toBe("canal_off");
    expect(classifyFailure("algo estranho").kind).toBe("outro");
  });

  it("o que o fluxo fez vira o que o lote faz", () => {
    expect(decideFlowOutcome("started", { privateReplyUsed: true, status: "DONE", stopReason: null }).item).toBe("SENT");
    expect(decideFlowOutcome("FAILED", { privateReplyUsed: false, status: "FAILED", stopReason: "Meta API Error 100: x" })).toMatchObject({ item: "FAILED" });
    const rl = decideFlowOutcome("FAILED", { privateReplyUsed: false, status: "FAILED", stopReason: "Meta API Error 4: x" });
    expect(rl.item).toBe("RETRY");
    expect(rl.pause?.ms).toBeGreaterThan(0);
    expect(decideFlowOutcome("FAILED", { privateReplyUsed: false, status: "FAILED", stopReason: "maybe_sent" }).item).toBe("FAILED");
    expect(decideFlowOutcome("STOPPED_WINDOW", { privateReplyUsed: false, status: "STOPPED_WINDOW", stopReason: "window_closed" }).item).toBe("FAILED");
    expect(decideFlowOutcome("STOPPED_TAKEOVER", { privateReplyUsed: false, status: "STOPPED_TAKEOVER", stopReason: "takeover" }).item).toBe("SKIPPED");
    expect(decideFlowOutcome("duplicate", null).item).toBe("SKIPPED");
    expect(decideFlowOutcome("busy", null).item).toBe("RETRY");
    expect(decideFlowOutcome("skipped", null).abort).toBeTruthy();
  });
});

describe("MCP e chave de API", () => {
  it("a chave alcança /api/resgate e a ferramenta existe com dryRun documentado", async () => {
    const { isApiKeyRouteAllowed } = await import("../lib/api-key-routes");
    expect(isApiKeyRouteAllowed("POST", "/api/resgate")).toBe(true);
    expect(isApiKeyRouteAllowed("GET", "/api/resgate")).toBe(true);
    const { RESGATE_TOOLS } = await import("../lib/mcp/resgate-tools");
    const tool = RESGATE_TOOLS[0];
    expect(tool.name).toBe("resgatar_comentarios");
    const calls: [string, string, unknown][] = [];
    const call = async (m: string, p: string, b?: unknown) => {
      calls.push([m, p, b]);
      return { status: 200, json: { success: true, data: { ok: 1 } } };
    };
    await tool.run({ post: "x", fluxoId: "f", ignorado: 1 }, call as never);
    expect(calls[0]).toEqual(["POST", "/api/resgate", { post: "x", fluxoId: "f" }]);
    await tool.run({ execucaoId: "r1" }, call as never);
    expect(calls[1][0]).toBe("GET");
    expect(calls[1][1]).toBe("/api/resgate?execucaoId=r1");
  });
});
