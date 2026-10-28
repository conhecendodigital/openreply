"use client";

/**
 * Fichas dos leads do vendedor automático (29/10/2026): o que o vendedor sabe de cada pessoa, com a ORIGEM
 * de cada campo. O dono corrige: o que ele escreve vira "dono" e a IA nunca sobrescreve.
 */

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { channelBtnSecondary } from "@/components/channels/types";

type Campo = { valor: string; origem: string; evidencia?: string };
type FichaRow = { contactId: string; nome: string | null; username: string | null; estagio: string; campos: Record<string, Campo | undefined> };

const CAMPOS: [string, string][] = [
  ["negocio", "Business/niche"],
  ["oQueFaz", "What they do"],
  ["local", "Where they live"],
  ["dor", "Pain"],
  ["objetivo", "Goal"],
  ["objecoes", "Objections"],
];
const ESTAGIOS = ["novo", "entendendo", "viu_valor", "recebeu_link", "sumiu", "comprou"];
const ORIGEM: Record<string, string> = {
  dito_pela_pessoa: "said in DM",
  comentario: "comment",
  etiqueta: "tag",
  quiz: "quiz",
  perfil_oficial: "official profile",
  dono: "you",
};
const field = "w-full rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent/50";

export function VendedorFichas({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const t = useT();
  const url = `/api/channels/instagram/${encodeURIComponent(accountId)}/vendedor/fichas`;
  const [fichas, setFichas] = useState<FichaRow[] | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [estagio, setEstagio] = useState("novo");
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => alive && j?.success && setFichas((j.data as { fichas: FichaRow[] }).fichas))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url, tick]);

  function abrir(f: FichaRow) {
    setAberta(f.contactId);
    setEstagio(f.estagio);
    setEdit(Object.fromEntries(CAMPOS.map(([k]) => [k, f.campos[k]?.valor ?? ""])));
    setMsg(null);
  }

  async function salvar(f: FichaRow) {
    const campos: Record<string, string | null> = {};
    for (const [k] of CAMPOS) {
      const novo = (edit[k] ?? "").trim();
      if (novo !== (f.campos[k]?.valor ?? "")) campos[k] = novo || null;
    }
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: f.contactId, campos, estagio }) });
    const j = await res.json().catch(() => null);
    setMsg(j?.success ? "Saved." : typeof j?.error === "string" ? j.error : "Could not save.");
    if (j?.success) setTick((n) => n + 1);
  }

  if (!fichas || fichas.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold">{t("Lead files (what the seller knows about each person)")}</h4>
      <ul className="space-y-1">
        {fichas.map((f) => (
          <li key={f.contactId} className="rounded-lg border border-border p-2 text-xs">
            <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => (aberta === f.contactId ? setAberta(null) : abrir(f))}>
              <span>{f.nome || (f.username ? `@${f.username}` : t("Lead"))}</span>
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-muted">{f.estagio}</span>
            </button>
            {aberta === f.contactId && (
              <div className="mt-2 space-y-2">
                {CAMPOS.map(([k, label]) => (
                  <label key={k} className="block text-muted">
                    {t(label)}
                    {f.campos[k] && <span className="ml-1 opacity-70">({t(ORIGEM[f.campos[k]!.origem] ?? f.campos[k]!.origem)})</span>}
                    <input value={edit[k] ?? ""} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} disabled={!canManage} maxLength={300} className={field} />
                  </label>
                ))}
                {f.campos.seguidores && (
                  <p className="text-muted">
                    {t("Followers")}: {f.campos.seguidores.valor} ({t(ORIGEM[f.campos.seguidores.origem] ?? f.campos.seguidores.origem)})
                  </p>
                )}
                <label className="block text-muted">
                  {t("Stage")}
                  <select value={estagio} onChange={(e) => setEstagio(e.target.value)} disabled={!canManage} className={field}>
                    {ESTAGIOS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                {canManage && (
                  <div className="flex items-center gap-3">
                    <button type="button" className={channelBtnSecondary} onClick={() => void salvar(f)}>
                      {t("Save file")}
                    </button>
                    {msg && <span className="text-muted">{t(msg)}</span>}
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
