/**
 * Raio de atendimento: cidade fora da lista, mas perto de uma cidade atendida,
 * conta como atendida (ex.: Sumaré a 20 km de Campinas). Longe do raio, é fora
 * da área e o agente recusa com educação. Sem raio (0), só a lista vale.
 */
import { MUNICIPIOS } from "./municipios-dados";
import { normalizarTexto } from "./texto";
import type { RegrasNegocio } from "./esquema";

interface Municipio {
  nome: string;
  uf: string;
  lat: number;
  lon: number;
}

let indice: Map<string, Municipio[]> | null = null;

function carregar(): Map<string, Municipio[]> {
  if (indice) return indice;
  indice = new Map();
  for (const linha of MUNICIPIOS.split("\n")) {
    const [nome, uf, lat, lon] = linha.split(";");
    const k = normalizarTexto(nome);
    const lista = indice.get(k) ?? [];
    lista.push({ nome, uf, lat: Number(lat), lon: Number(lon) });
    indice.set(k, lista);
  }
  return indice;
}

/** O município pelo nome. Sem UF e com nome repetido, prefere as UFs dadas (as das cidades atendidas). */
export function acharMunicipio(nome: string, uf = "", ufsPreferidas: string[] = []): Municipio | null {
  const lista = carregar().get(normalizarTexto(nome));
  if (!lista?.length) return null;
  if (uf) return lista.find((m) => m.uf === uf.toUpperCase()) ?? null;
  if (lista.length === 1) return lista[0];
  return lista.find((m) => ufsPreferidas.includes(m.uf)) ?? null;
}

export function distanciaKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** true = dentro do raio de alguma cidade atendida; false = longe; null = sem raio ou cidade desconhecida. */
export function dentroDoRaio(regras: RegrasNegocio, nome: string, uf = ""): boolean | null {
  if (!regras.raioKm || !regras.cidadesAtendidas.length) return null;
  const ufs = [...new Set(regras.cidadesAtendidas.map((c) => c.uf).filter(Boolean))];
  const alvo = acharMunicipio(nome, uf, ufs);
  if (!alvo) return null;
  for (const c of regras.cidadesAtendidas) {
    const centro = acharMunicipio(c.cidade, c.uf, ufs);
    if (centro && distanciaKm(centro, alvo) <= regras.raioKm) return true;
  }
  return false;
}
