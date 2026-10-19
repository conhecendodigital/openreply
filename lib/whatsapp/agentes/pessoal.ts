/**
 * 19/10 (Robério, Aquele Tapa): o agente de qualificação perguntava "Em qual
 * cidade será a obra?" pra filha ("Te amo também, Duda ❤️ Em qual cidade será
 * a obra?"), pro pai ("Parabéns, filho") e pro próprio Robério. O número é o
 * WhatsApp da empresa, mas também chega conversa pessoal.
 *
 * Regras sem IA (custo zero):
 * - o número do responsável (quem recebe os leads) nunca é atendido pelo agente;
 * - conversa em que o dono já escreveu à mão é dele: o agente fica de fora.
 */
import type { WaMessageLite } from "./types";

function digitos(t: string | null | undefined): string {
  let d = (t ?? "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  // Celular com o 9 depois do DDD: compara sem ele (o WhatsApp às vezes guarda sem).
  if (d.length === 11 && d[2] === "9") d = d.slice(0, 2) + d.slice(3);
  return d;
}

/** O contato é o próprio responsável (mesmo número, com ou sem 55 e o 9). */
export function ehNumeroDoResponsavel(telefoneContato: string | null | undefined, telefoneResponsavel: string | null | undefined): boolean {
  const a = digitos(telefoneContato);
  const b = digitos(telefoneResponsavel);
  return a.length >= 10 && a === b;
}

/**
 * 19/10 (Matheus: "não é pra entrar em conversa que é do Robério"): o dono
 * escreveu à mão nessa conversa = a conversa é dele, com ou sem pedido na ficha.
 * Só volta pro agente se alguém escolher o modo da conversa na tela (AUTO ou
 * RASCUNHO em vez de "herdar do número").
 */
export function conversaDoDono(historico: WaMessageLite[], modoDaConversa: string | null | undefined): boolean {
  if (modoDaConversa === "AUTO" || modoDaConversa === "DRAFT") return false;
  return historico.some((m) => m.fromMe && (m.sentBy === "USER_PHONE" || m.sentBy === "USER_APP"));
}
