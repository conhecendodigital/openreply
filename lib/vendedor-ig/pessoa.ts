/**
 * Cartão da pessoa: o que já sabemos dela, só de fontes oficiais e do nosso próprio banco.
 *
 * Fontes: o que ela mesma comentou (CRM), etiquetas, anotações do dono, quiz/lead (respostas),
 * e o perfil oficial pela User Profile API (name, username, follower_count, is_user_follow_business),
 * que a doc da Meta confirma para quem mandou DM (consentimento). Business Discovery NÃO é usado:
 * a doc lida em 28/10/2026 só o documenta para o login do Facebook, não para o login do Instagram.
 * Sem navegador, sem foto, sem mídia. Cache de 24 h por pessoa e limite de chamadas por rodada.
 * O texto do cartão vai ao modelo dentro de <dados> e nunca para log.
 */
import { blocoDeDados } from "@/lib/whatsapp/agentes/comando";

export const CACHE_PERFIL_MS = 24 * 60 * 60 * 1000;
export const MAX_CONSULTAS_PERFIL_POR_RODADA = 5;

export type DadosPessoa = {
  nome: string | null;
  username: string | null;
  etiquetas: string[];
  anotacoes: string | null;
  /** Últimos comentários dela nos nossos posts (texto dela, já cortado). */
  comentarios: string[];
  /** Respostas de quiz/lead: pergunta -> resposta. */
  quiz: Record<string, string>;
  seguidores: number | null;
  seguePraNos: boolean | null;
};

function corta(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Texto do cartão, ou "" quando não há nada confiável. O vendedor só pode usar o que está aqui. */
export function montarCartao(d: DadosPessoa): string {
  const linhas: string[] = [];
  if (d.nome) linhas.push(`Nome: ${corta(d.nome, 60)}`);
  if (d.username) linhas.push(`Usuário no Instagram: @${corta(d.username, 40)}`);
  if (d.seguidores !== null) linhas.push(`Seguidores (dado oficial do perfil): ${d.seguidores}`);
  if (d.seguePraNos !== null) linhas.push(d.seguePraNos ? "Já segue o perfil." : "Ainda não segue o perfil.");
  if (d.etiquetas.length) linhas.push(`Etiquetas nossas: ${d.etiquetas.slice(0, 10).map((e) => corta(e, 30)).join(", ")}`);
  if (d.anotacoes) linhas.push(`Anotação do dono: ${corta(d.anotacoes, 300)}`);
  if (d.comentarios.length) linhas.push(`O que ela comentou nos nossos posts:\n${d.comentarios.slice(0, 3).map((c) => `- ${corta(c, 160)}`).join("\n")}`);
  const quiz = Object.entries(d.quiz).slice(0, 8);
  if (quiz.length) linhas.push(`Respostas do quiz:\n${quiz.map(([k, v]) => `- ${corta(k, 60)}: ${corta(v, 100)}`).join("\n")}`);
  if (linhas.length === 0) return "";
  return blocoDeDados("cartão da pessoa", linhas.join("\n"));
}

export function perfilVencido(fetchedAt: Date | null | undefined, now: Date): boolean {
  return !fetchedAt || now.getTime() - fetchedAt.getTime() >= CACHE_PERFIL_MS;
}
