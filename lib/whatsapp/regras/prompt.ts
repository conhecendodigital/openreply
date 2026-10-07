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
import { blocosDaFicha, type CampoFichaDef, type FichaLead } from "./ficha";

const DECISAO_TEXTO: Record<string, string> = {
  qualificar: "qualificar",
  analisar: "passar pra análise",
  fora_da_area: "responder com cuidado que o local precisa ser analisado (fora da área)",
  servico_recusado: "responder com educação que a empresa não faz esse serviço",
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
      `ONDE ATENDE (o que vale é o local da OBRA, não onde a pessoa mora): ${r.cidadesAtendidas.map(rotuloCidade).join(", ")}. Qualquer outra cidade está FORA da área.`
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
  if (r.cidadesAtendidas.length) {
    partes.push("SE AINDA NÃO SABE ONDE É A OBRA: pergunte em qual cidade vai ser a obra. Nunca confirme atendimento antes de saber.");
    partes.push(
      `FORA DA ÁREA: nunca diga que atende, nunca marque qualificado e nunca recuse de forma seca. ${r.mensagemForaDaArea ? `Como responder: ${r.mensagemForaDaArea}` : "Diga com cuidado que a disponibilidade pra esse local precisa ser analisada."} Se for uma exceção de local, passe pra humano com motivo "para analisar".`
    );
  }
  partes.push(linha("SERVIÇOS ACEITOS", r.servicosAceitos));
  if (r.servicosRecusados.length) {
    partes.push(
      `SERVIÇOS QUE A EMPRESA NÃO FAZ: ${r.servicosRecusados.map((s) => s.descricao).join("; ")}. Nunca diga que faz e nunca marque qualificado. ${r.mensagemServicoRecusado ? `Como responder: ${r.mensagemServicoRecusado}` : "Responda com educação e conte o que a empresa faz."}`
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
  if (msgs.length) partes.push(`MENSAGENS APROVADAS (use o texto exato):\n${msgs.map((m) => `${m.quando ? `${m.quando}: ` : ""}"${m.texto}"`).join("\n")}`);
  if (r.casosTeste.length) {
    partes.push(
      `CASOS DO DONO (decida assim em casos parecidos):\n${r.casosTeste
        .map((c, i) => `${i + 1}. ${c.situacao} -> ${c.decisao || c.esperado.map((d) => DECISAO_TEXTO[d]).join(" ou ")}${c.motivo ? ` (${c.motivo})` : ""}`)
        .join("\n")}`
    );
  }
  const corpo = partes.filter(Boolean).join("\n");
  if (!corpo) return "";
  return `REGRAS DURAS DO NEGÓCIO (o sistema confere cada resposta; se quebrar uma regra, a resposta não sai):\n${corpo}`;
}

/** Campos extras da resposta quando há regras (o código confere tudo no texto do cliente). */
export function formatoExtra(r: RegrasNegocio | null | undefined): string {
  if (!temRegras(r)) return "";
  return `CAMPOS EXTRAS NO JSON (obrigatórios quando há regras do negócio): "local_obra": {"cidade": "", "uf": "", "bairro": ""} com o que o CLIENTE disse sobre o local da OBRA (vazio se não disse), "servico": "aceito" | "recusado" | "excecao" | "desconhecido", "excecao": "" (qual exceção de local vale, ou vazio), "coletado": {"<informação mínima>": "como o cliente disse"} (só o que ele disse). Nunca preencha nada que o cliente não disse.`;
}

/** Ficha do lead (parte variável). */
export function blocoFicha(ficha: FichaLead, defs: CampoFichaDef[]): { sabe: string; falta: string } {
  if (!defs.length) return { sabe: "", falta: "" };
  const b = blocosDaFicha(ficha, defs);
  return {
    sabe: b.sabe,
    falta: b.falta
      ? `O QUE AINDA FALTA PERGUNTAR (pergunte só UM por vez, nessa ordem; nunca pergunte o que já está em "o que você já sabe"):\n${b.falta}`
      : "O QUE AINDA FALTA PERGUNTAR: nada das informações mínimas. Não repita perguntas.",
  };
}
