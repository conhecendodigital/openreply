/**
 * 19/10 (Robério, Aquele Tapa): o agente de qualificação perguntava "Em qual
 * cidade será a obra?" pra filha ("Te amo também, Duda ❤️ Em qual cidade será
 * a obra?"), pro pai ("Parabéns, filho") e pro próprio Robério. O número é o
 * WhatsApp da empresa, mas também chega conversa pessoal.
 *
 * Regras sem IA (custo zero):
 * - o número do responsável (quem recebe os leads) nunca é atendido pelo agente;
 * - conversa em que o dono já escreveu à mão e a ficha não tem nada do pedido
 *   (cidade, serviço, imóvel) é conversa dele: o agente fica de fora.
 */
import type { CampoFichaDef, FichaLead } from "@/lib/whatsapp/regras/ficha";
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

const TIPOS_DO_PEDIDO = new Set(["cidade", "bairro", "imovel", "servico"]);

/** O dono já escreveu à mão nessa conversa e a ficha não tem nada do pedido. */
export function conversaPessoalDoDono(historico: WaMessageLite[], ficha: FichaLead | null | undefined, defs: CampoFichaDef[]): boolean {
  const donoEscreveu = historico.some((m) => m.fromMe && (m.sentBy === "USER_PHONE" || m.sentBy === "USER_APP"));
  if (!donoEscreveu) return false;
  const campos = ficha?.campos ?? {};
  const temPedido = defs.some((d) => TIPOS_DO_PEDIDO.has(d.tipo) && campos[d.chave] && campos[d.chave].origem !== "inferido");
  return !temPedido;
}
