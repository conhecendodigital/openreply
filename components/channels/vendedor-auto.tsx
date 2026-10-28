"use client";

/**
 * Vendedor automático do Instagram (28/10/2026). DESLIGADO por padrão. Só o dono liga aqui, na tela:
 * a chave de API/MCP não consegue (a rota é humanOnly). Mostra o resumo do dia, o documento de fatos
 * da oferta (a única fonte de preço, entrega e link), a prova social real e os limites.
 */

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { VendedorFichas } from "@/components/channels/vendedor-fichas";
import { channelBtnPrimary, channelBtnSecondary } from "@/components/channels/types";

type Config = {
  enabled: boolean;
  offerFacts: string;
  socialProof: string;
  licoes: string;
  minGapSeconds: number;
  maxPerHour: number;
  maxPerDay: number;
  maxPerPersonDay: number;
  replyDelayMinSec: number;
  replyDelayMaxSec: number;
  quietStart: string | null;
  quietEnd: string | null;
};
type Today = { enviadas: number; mensagensEnviadas: number; rascunhos: number; puladas: number; paradas: number; erros: number; gastoUsd: number; porMotivo: { motivo: string; total: number }[] };
type Payload = { config: Config; envDisabled: boolean; defaultOfferFacts: string; defaultLicoes: string; today?: Today };

const field = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50";

export function VendedorAutoPanel({ accountId, canManage }: { accountId: string; canManage: boolean }) {
  const t = useT();
  const url = `/api/channels/instagram/${encodeURIComponent(accountId)}/vendedor`;
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!alive || !json?.success) return;
        setData(json.data as Payload);
        setForm((json.data as Payload).config);
      })
      .catch(() => alive && setMsg("Could not load the automatic seller."));
    return () => {
      alive = false;
    };
  }, [url, tick]);

  async function save(patch: Partial<Config>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const json = await res.json();
      if (!json?.success) setMsg(typeof json?.error === "string" ? json.error : "Could not save.");
      else {
        setMsg(done);
        setTick((n) => n + 1);
      }
    } catch {
      setMsg("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!data || !form) return null;
  const on = data.config.enabled;
  const num = (k: keyof Config, label: string) => (
    <label className="block text-xs text-muted">
      {t(label)}
      <input
        type="number"
        value={Number(form[k] ?? 0)}
        onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })}
        disabled={!canManage}
        className={field}
      />
    </label>
  );

  return (
    <section className="panel space-y-3 rounded-xl p-4" aria-label={t("Automatic seller")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t("Automatic seller")}</h3>
          <p className="text-xs text-muted">
            {t("Answers by itself, in short messages, only inside the 24-hour window. Off by default. Anything doubtful becomes a draft for you.")}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${on ? "bg-success/10 text-success" : "bg-surface-hover text-muted"}`}>
          {on ? t("On") : t("Off")}
        </span>
      </div>

      {data.envDisabled && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs">{t("Emergency switch active (VENDEDOR_IG_DISABLED): nothing is sent, whatever the setting.")}</p>
      )}

      {canManage ? (
        <button
          type="button"
          disabled={busy}
          className={on ? channelBtnSecondary : channelBtnPrimary}
          onClick={() => {
            if (!on && !window.confirm(t("Turn the automatic seller on? It will answer people by itself on this account."))) return;
            void save({ enabled: !on }, on ? "Turned off." : "Turned on.");
          }}
        >
          {on ? t("Turn off") : t("Turn on")}
        </button>
      ) : (
        <p className="text-xs text-muted">{t("Only owners and admins can change this.")}</p>
      )}

      {data.today && (
        <p className="text-xs text-muted">
          {t("Today: {sent} answered ({msgs} messages), {drafts} drafts, {skipped} skipped, {stopped} asked to stop, {errors} errors.", {
            sent: data.today.enviadas,
            msgs: data.today.mensagensEnviadas,
            drafts: data.today.rascunhos,
            skipped: data.today.puladas,
            stopped: data.today.paradas,
            errors: data.today.erros,
          })}
        </p>
      )}

      <label className="block text-xs text-muted">
        {t("Offer facts (the seller only states what is written here)")}
        <textarea
          rows={8}
          value={form.offerFacts || data.defaultOfferFacts}
          onChange={(e) => setForm({ ...form, offerFacts: e.target.value })}
          disabled={!canManage}
          className={field}
        />
      </label>
      <label className="block text-xs text-muted">
        {t("Real social proof (leave empty and the seller cites none)")}
        <textarea rows={3} value={form.socialProof} onChange={(e) => setForm({ ...form, socialProof: e.target.value })} disabled={!canManage} className={field} />
      </label>

      <label className="block text-xs text-muted">
        {t("Seller lessons (short rules from you: what to avoid, what to repeat; up to 2000 characters)")}
        <textarea
          rows={6}
          maxLength={2000}
          value={form.licoes || data.defaultLicoes}
          onChange={(e) => setForm({ ...form, licoes: e.target.value })}
          disabled={!canManage}
          className={field}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {num("minGapSeconds", "Seconds between conversations")}
        {num("maxPerHour", "Max per hour")}
        {num("maxPerDay", "Max per day")}
        {num("maxPerPersonDay", "Max per person per day")}
        {num("replyDelayMinSec", "Reply delay, min (s)")}
        {num("replyDelayMaxSec", "Reply delay, max (s)")}
      </div>

      {canManage && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            className={channelBtnSecondary}
            onClick={() => {
              const rest: Partial<Config> = { ...form };
              delete rest.enabled;
              void save(rest, "Saved.");
            }}
          >
            {t("Save settings")}
          </button>
          {msg && <span className="text-xs text-muted">{t(msg)}</span>}
        </div>
      )}

      <VendedorFichas accountId={accountId} canManage={canManage} />
    </section>
  );
}
