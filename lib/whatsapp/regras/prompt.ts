/**
 * O que das regras entra no Comando do agente.
 *
 * Parte FIXA (vai pro cache de prompt da Anthropic, junto com o resto da parte
 * fixa): o resumo estruturado das regras duras, as mensagens aprovadas e os
 * casos de teste do briefing. Entra SEMPRE, não depende do cérebro (RAG) achar
 * o trecho certo. O RAG continua pros detalhes.
 *
 * Parte VARIÁVEL (depois do ponto de cache): a ficha do lead ("o que você já
 * sabe" e "o que ainda falta perguntar") e os exemplos aprendidos parecidos
 * com a conversa. Texto que veio do cliente ou da equipe vai em <dados>.
 */
import { rotuloCidade, temRegras, type RegrasNegocio } from "./esquema";
import { FECHO_RECUSA } from "./fecho";
import { blocosDaFicha, type CampoFichaDef, type FichaLead } from "./ficha";

const DECISAO_TEXTO: Record<string, string> = {
  qualificar: "qualificar",
  analisar: "passar pra análise",
  fora_da_area: "recusar com educação, fechando com \"vamos analisar o seu caso e entramos em contato\" (fora da área)",
  servico_recusado: "recusar com educação, fechando com \"vamos analisar o seu caso e entramos em contato\" (serviço que a empresa não faz)",
  humano: "passar pra uma pessoa",
  continuar: "seguir a conversa",
};

function linha(titulo: string, itens: string[]): string {
  return itens.length ? `${titulo}: ${itens.join("; ")}.` : "";
}

/** Resumo das regras duras (parte fixa). Vazio se não tem nada. */
export function blocoRegras(r: RegrasNegocio | null | undefined, baseCommand = ""): string {
  if (!r) return "";
  const partes: string[] = [];
  if (r.cidadesAtendidas.length) {
    partes.push(
      `ONDE ATENDE (o que vale é o local da OBRA, não onde a pessoa mora): ${r.cidadesAtendidas.map(rotuloCidade).join(", ")}${r.raioKm ? ` e cidades a até ${r.raioKm} km delas` : ""}. Qualquer outra cidade está FORA da área.`
    );
  }
  partes.push(linha("CIDADES NÃO ATENDIDAS", r.cidadesNaoAtendidas.map(rotuloCidade)));
  if (r.regioesCuidado.length) {
    partes.push(
      `REGIÕES COM CUIDADO (vão pra análise da equipe; nunca diga que não atende): ${r.regioesCuidado
        .map((x) => `${x.nome}${x.cidade ? ` (${rotuloCidade({ cidade: x.cidade, uf: x.uf })})` : ""}${x.regra ? `: ${x.regra}` : ""}`)
        .join("; ")}.`
    );
  }
  partes.push(linha("EXCEÇÕES DE LOCAL (vão pra análise da equipe)", r.excecoesLocal.map((e) => e.descricao)));
  const quem = r.responsavel.nome.trim() || "o responsável";
  if (r.regioesCuidado.length || r.excecoesLocal.length) {
    partes.push(
      `QUANDO PASSAR PRA ANÁLISE: termine dizendo que vai passar pro ${quem} analisar a possibilidade e que, se for possível, vocês entram em contato. Nunca prometa que vai dar certo nem dê prazo.`
    );
  }
  // 14/10 (Matheus): o agente entende a pessoa e leva pra qualificação sem esticar; caso complexo é com o responsável.
  const naoPare = (
    `NÃO PARE DE ATENDER: toda mensagem do cliente recebe resposta, mesmo depois de uma recusa. Entenda o que a pessoa quer e leve pra qualificação sem esticar a conversa (uma pergunta por vez, só o que falta). CASO COMPLEXO OU FORA DO COMUM (dúvida técnica, vistoria, laudo, pedido que continua confuso depois de uma pergunta): não recuse; passe pra análise dizendo que o ${quem} vai entrar em contato pra marcar uma conversa com você, online ou no escritório. Sem prazo e sem promessa.`
  );
  const fechoRecusa = `Sempre feche a recusa com: "${FECHO_RECUSA}" (pode dizer do seu jeito, sem prazo).`;
  if (r.cidadesAtendidas.length) {
    partes.push("SE AINDA NÃO SABE ONDE É A OBRA: pergunte em qual cidade vai ser a obra. Nunca confirme atendimento antes de saber.");
    partes.push(
      `FORA DA ÁREA (fora do perfil): recuse com educação. ${r.mensagemForaDaArea ? `Como responder: ${r.mensagemForaDaArea}` : "Diga com gentileza que a empresa não atende essa região e agradeça o contato."} ${fechoRecusa} Não faça pergunta nova, não peça mais dados, não passe pra humano e não marque qualificado. Se você já recusou nessa conversa, não repita a recusa nem o fecho: responda numa frase curta o que a pessoa disse agora (se ela disse que a cidade não é essa, peça desculpa e pergunte de novo em qual cidade é a obra). Só se for uma das EXCEÇÕES DE LOCAL, passe pra humano com motivo "para analisar".`
    );
  }
  partes.push(linha("SERVIÇOS ACEITOS", r.servicosAceitos));
  if (r.servicosRecusados.length) {
    partes.push(
      `SERVIÇOS QUE A EMPRESA NÃO FAZ (fora do perfil, ex.: só trocar uma torneira, reforminha simples e isolada): ${r.servicosRecusados.map((s) => s.descricao).join("; ")}. Nunca diga que faz, nunca marque qualificado e não passe pra humano. ${r.mensagemServicoRecusado ? `Como responder: ${r.mensagemServicoRecusado}` : "Recuse com educação e conte numa frase o que a empresa faz, sem pergunta nova."} ${fechoRecusa} Se a pessoa também pedir um serviço que a empresa faz, siga só com esse.`
    );
  }
  partes.push(linha("EXCEÇÕES DE SERVIÇO (esses são atendidos)", r.excecoesServico.map((s) => s.descricao)));
  if (r.infoMinima.length) {
    partes.push(
      `INFORMAÇÕES MÍNIMAS PRA QUALIFICAR (qualificado só com TODAS, ditas pelo cliente): ${r.infoMinima.map((i) => i.campo).join("; ")}. Pergunte só o que falta. Se faltarem 3 ou mais, junte duas numa pergunta só, do jeito que se fala (ex.: "Qual seu nome e o bairro da obra?"). Com todas ditas, qualifique na hora, sem pergunta extra.`
    );
  }
  if (r.horario) partes.push(`HORÁRIO DE ATENDIMENTO: ${r.horario}`);
  partes.push(linha("NUNCA AFIRME OU PROMETA", r.nuncaPrometer));
  const msgs = r.mensagensAprovadas.filter((m) => !baseCommand.includes(m.texto));
  // 14/10 (Matheus): a saudação fixa fazia toda conversa abrir igual, com cara de robô.
  // Cumprimento vira exemplo de tom; encaminhamento, recusa e o resto seguem no texto exato.
  const saudacoes = msgs.filter((m) => ehSaudacao(m.quando));
  const exatas = msgs.filter((m) => !ehSaudacao(m.quando));
  if (saudacoes.length) {
    partes.push(
      `JEITO DE CUMPRIMENTAR QUEM CHEGA (exemplo de tom, NÃO copie igual): ${saudacoes.map((m) => `"${m.texto}"`).join(" / ")}. Cumprimente com suas palavras, diferente a cada pessoa, no mesmo tom, e faça a mesma primeira pergunta.`
    );
  }
  if (exatas.length) partes.push(`MENSAGENS APROVADAS (use o texto exato):\n${exatas.map((m) => `${m.quando ? `${m.quando}: ` : ""}"${m.texto}"`).join("\n")}`);
  if (r.casosTeste.length) {
    partes.push(
      `CASOS DO DONO (decida assim em casos parecidos):\n${r.casosTeste
        .map((c, i) => `${i + 1}. ${c.situacao} -> ${c.decisao || c.esperado.map((d) => DECISAO_TEXTO[d]).join(" ou ")}${c.motivo ? ` (${c.motivo})` : ""}`)
        .join("\n")}`
    );
  }
  if (!partes.some(Boolean)) return "";
  const corpo = [...partes, naoPare].filter(Boolean).join("\n");
  return `REGRAS DURAS DO NEGÓCIO (o sistema confere cada resposta; se quebrar uma regra, a resposta não sai):\n${corpo}`;
}

/** Campos extras da resposta quando há regras (o código confere tudo no texto do cliente). */
export function formatoExtra(r: RegrasNegocio | null | undefined): string {
  if (!temRegras(r)) return "";
  return `CAMPOS EXTRAS NO JSON (obrigatórios quando há regras do negócio): "local_obra": {"cidade": "", "uf": "", "bairro": ""} com o que o CLIENTE disse sobre o local da OBRA (vazio se não disse), "servico": "aceito" | "recusado" | "excecao" | "desconhecido", "excecao": "" (qual exceção de local vale, ou vazio), "coletado": {"<informação mínima>": "como o cliente disse"} (só o que ele disse). Nunca preencha nada que o cliente não disse.`;
}

/**
 * Ficha do lead (parte variável).
 * 19/10: o agente só soube das regras de local e de pergunta repetida DEPOIS de errar (o verificador
 * mandava corrigir). Agora a próxima pergunta já vem decidida aqui, calculada em código com a mesma
 * lógica do verificador: cidade primeiro enquanto o local é desconhecido, nunca o que já foi dito.
 * Só texto da parte variável; a parte fixa do Comando não muda (custo igual).
 */
export function blocoFicha(ficha: FichaLead, defs: CampoFichaDef[]): { sabe: string; falta: string } {
  if (!defs.length) return { sabe: "", falta: "" };
  const b = blocosDaFicha(ficha, defs);
  const faltando = defs.filter((d) => d.obrigatorio && !ficha.campos[d.chave]);
  if (!faltando.length) {
    return { sabe: b.sabe, falta: "O QUE AINDA FALTA PERGUNTAR: nada das informações mínimas. Não repita perguntas." };
  }
  const semLocal = defs.some((d) => d.tipo === "cidade") && !defs.some((d) => d.tipo === "cidade" && ficha.campos[d.chave]);
  const ordem = semLocal ? [...faltando].sort((a, c) => Number(c.tipo === "cidade") - Number(a.tipo === "cidade")) : faltando;
  const rotulo = (d: CampoFichaDef) => `${d.rotulo}${d.pergunta ? ` (ex.: "${d.pergunta}")` : ""}`;
  const respondidos = defs.filter((d) => ficha.campos[d.chave]).map((d) => d.rotulo);
  const linhas = [
    `PERGUNTE AGORA, e só isso (uma pergunta, na última bolha): ${rotulo(ordem[0])}.`,
    ordem.length > 1 ? `Depois, uma por vez, nessa ordem: ${ordem.slice(1).map((d) => d.rotulo).join("; ")}.` : "",
    respondidos.length ? `JÁ RESPONDIDO, nunca pergunte de novo (nem com outras palavras): ${respondidos.join("; ")}.` : "",
    semLocal
      ? "O LOCAL DA OBRA AINDA É DESCONHECIDO: não diga que atende, que faz nem \"claro, dá sim\" pra nenhum lugar ou serviço até o cliente dizer a cidade. Primeiro a cidade."
      : "",
  ].filter(Boolean);
  return { sabe: b.sabe, falta: `O QUE AINDA FALTA PERGUNTAR:\n${linhas.join("\n")}` };
}

/** "quando" de mensagem aprovada que é cumprimento de abertura (vira exemplo de tom). */
export function ehSaudacao(quando: string | null | undefined): boolean {
  const q = (quando ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /primeir[oa] (contato|mensagem|resposta)|boas[ -]?vindas|saudacao|cumprimento|abertura|pessoa nova|quando (a pessoa|o cliente) (chega|manda oi)/.test(q);
}
