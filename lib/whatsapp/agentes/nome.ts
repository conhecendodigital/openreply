/**
 * Nome da pessoa a partir do contato do WhatsApp (nome salvo na agenda ou o
 * nome que ela pôs no perfil). Pedido do Matheus (14/10): pegar primeiro e
 * segundo nome do contato e não perguntar o nome quando ele já existe.
 * "Marcelo H2" virava nada (o número reprovava o nome inteiro) e o agente
 * perguntava "Qual seu nome?".
 */

/** Partículas que ficam entre o primeiro e o segundo nome ("Maria da Silva"). */
const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "e"]);

/** Títulos que saem do começo ("Dr. Paulo" vira "Paulo"). */
const TITULOS = new Set(["dr", "dra", "sr", "sra", "prof", "profa", "pr", "pra"]);

/** Palavra de empresa ou de cargo: o contato não é uma pessoa, não usa como nome. */
const EMPRESA = new Set([
  "ltda", "me", "mei", "eireli", "sa", "loja", "store", "oficial", "construtora", "construcoes", "construcao",
  "reformas", "reforma", "imobiliaria", "imoveis", "materiais", "engenharia", "arquitetura", "empresa",
  "comercial", "servicos", "studio", "estudio", "atendimento", "suporte", "vendas", "financeiro", "grupo",
]);

/** Palavra genérica que não é nome ("Cliente", "Contato novo"): sai do texto. */
const GENERICO = new Set(["cliente", "contato", "novo", "nova", "whatsapp", "zap", "wpp", "lead"]);

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function bonito(p: string): string {
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

/**
 * Primeiro e segundo nome de um texto de contato, ou null se não parece nome
 * de gente. Tira emoji, número, pontuação e título; palavra com número
 * ("H2") sai, mas o resto do nome fica.
 */
export function primeiroESegundoNome(s: string | null | undefined): string | null {
  const palavras = (s ?? "")
    .replace(/[|/\\,;:()[\]{}"“”_•·*~+=<>@#&!?]/g, " ")
    .split(/\s+/)
    .map((p) => p.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ'’]+$/g, ""))
    .filter((p) => p && /^[A-Za-zÀ-ÿ'’.-]+$/.test(p));
  if (palavras.some((p) => EMPRESA.has(semAcento(p.replace(/\./g, ""))))) return null;
  while (palavras.length && TITULOS.has(semAcento(palavras[0].replace(/\./g, "")))) palavras.shift();
  const nomes = palavras
    .map((p) => p.replace(/\./g, ""))
    .filter((p) => !GENERICO.has(semAcento(p)) && (p.length >= 2 || PARTICULAS.has(semAcento(p))));
  const primeiro = nomes.findIndex((p) => !PARTICULAS.has(semAcento(p)) && p.length >= 2);
  if (primeiro < 0) return null;
  const out = [bonito(nomes[primeiro])];
  for (let i = primeiro + 1; i < nomes.length; i++) {
    const p = nomes[i];
    if (PARTICULAS.has(semAcento(p))) continue;
    const entre = nomes.slice(primeiro + 1, i).filter((x) => PARTICULAS.has(semAcento(x))).map((x) => x.toLowerCase());
    out.push(...entre, bonito(p));
    break;
  }
  const nome = out.join(" ");
  return nome.length >= 2 && nome.length <= 40 ? nome : null;
}

/** Nome salvo na agenda primeiro; se não serve, o nome do perfil. */
export function nomeDoContato(contato: { name: string | null | undefined; pushName: string | null | undefined }): string | null {
  return primeiroESegundoNome(contato.name) ?? primeiroESegundoNome(contato.pushName);
}

/**
 * Bloco do Comando sobre o nome. Com nome: o agente já sabe e não pergunta.
 * Sem nome: não inventa; só usa o nome que a pessoa disser na conversa.
 */
export function blocoNome(nome: string | null): string {
  if (nome) {
    const primeiro = nome.split(" ")[0];
    return `NOME DO CLIENTE (do contato do WhatsApp): ${nome}. Você já sabe o nome: NUNCA pergunte o nome da pessoa. Chame de ${primeiro} de vez em quando (no máximo uma vez por resposta e nunca no começo de toda bolha). Se a pessoa disser outro nome na conversa, use o que ela disse.`;
  }
  return "NOME DO CLIENTE: o contato não tem nome salvo. Não invente nome nem chame de um nome que a pessoa não disse. Só pergunte o nome se ele estiver em \"o que ainda falta perguntar\"; se a pessoa disser o nome, use.";
}
