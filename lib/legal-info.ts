/**
 * Dados da empresa que aparecem nas páginas públicas (Privacidade, Termos,
 * Exclusão de dados, rodapé). Troque AQUI e vale pro site inteiro, nas duas
 * línguas.
 *
 * Preenchido em 06/10/2026 com os dados do cartão CNPJ enviados pelo Matheus
 * (sede em Curitiba/PR) e o e-mail de contato confirmado por ele.
 * Enquanto estiverem com colchetes, as páginas mostram o marcador do jeito que
 * está, bem visível, pra ninguém publicar sem trocar.
 */
export type LegalInfo = {
  company: string;
  product: string;
  site: string;
  city: string;
  country: string;
  cnpj: string;
  address: string;
  email: string;
  updatedEn: string;
  updatedPt: string;
  deletionDays: number;
};

export const LEGAL_INFO: LegalInfo = {
  /** Razão social. */
  company: "DESTRAVE ACADEMY LTDA",
  /** Nome do produto. */
  product: "Lead Engine",
  /** Site do serviço. */
  site: "https://many.leadenginer.com",
  /** Cidade e estado (vai no endereço e no foro dos Termos). */
  city: "Curitiba/PR",
  country: "Brasil",
  /** CNPJ no formato 00.000.000/0000-00. */
  cnpj: "62.164.228/0001-74",
  /** Rua, número, bairro e CEP. */
  address: "Rua Bom Jesus, 212, Sala 1904, Juvevê, CEP 80035-010",
  /** E-mail de contato, privacidade e exclusão de dados. */
  email: "suporte@cloudmatheus.com.br",
  /** Data da última revisão dos textos legais (a mesma nas três páginas). */
  updatedEn: "October 6, 2026",
  updatedPt: "6 de outubro de 2026",
  /** Prazo de exclusão citado na política. */
  deletionDays: 30,
};

/** true enquanto algum dado da empresa ainda está com marcador. */
export function legalInfoPending(info: LegalInfo = LEGAL_INFO): boolean {
  return [info.cnpj, info.address, info.email].some((v) => /^\[.+\]$/.test(v));
}

/** Variáveis pra preencher os textos ({company}, {cnpj}, {address}, {email}...). */
export function legalVars(info: LegalInfo = LEGAL_INFO): Record<string, string | number> {
  return {
    company: info.company,
    product: info.product,
    site: info.site,
    city: info.city,
    country: info.country,
    cnpj: info.cnpj,
    address: info.address,
    email: info.email,
    days: info.deletionDays,
  };
}
