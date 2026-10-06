"use client";

/**
 * WhatsApp > Conexões (06/10/2026, pedido do dono: "tem que subir, não está
 * aparecendo no painel nem no menu").
 *
 * Conectar número pelo QR do gateway (OpenWA): termo de risco, QR que se
 * atualiza sozinho, estado conectado/desconectado e o número e nome conectados.
 * Desconectar pede confirmação e NUNCA apaga conversas, contatos nem
 * configurações (regra do dono: "não quero que quando canal desconectar já
 * saia apagando tudo"). Só dono ou admin do workspace conecta e desconecta.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import {
  api,
  btnDanger,
  btnPrimary,
  btnSecondary,
  ConfirmBox,
  formatPhone,
  INPUT,
  ServerNotice,
  StatusPill,
  useServerStatus,
  WhatsAppTabs,
  type WaStatus,
} from "@/components/whatsapp/ui";

type Session = {
  id: string;
  provider: "OPENWA" | "CLOUD_API";
  status: WaStatus;
  phoneE164: string | null;
  displayName: string | null;
  connectedAt: string | null;
  lastEventAt: string | null;
  conversationCount: number;
  messageCount: number;
};

/** O QR do WhatsApp troca a cada ~20 s: a tela pergunta de novo a cada 3 s. */
const QR_POLL_MS = 3_000;
const LIST_POLL_MS = 15_000;

export default function WhatsAppConnectionsPage() {
  const t = useT();
  const server = useServerStatus();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [pairing, setPairing] = useState<{ id: string; qr: string | null } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ sessions: Session[] }>("/api/whatsapp/sessions");
    if (r.ok) {
      setSessions(r.data.sessions);
      setLoadError(null);
    } else setLoadError(t(r.error));
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- primeira carga e atualização periódica da lista
    void load();
    const timer = window.setInterval(() => void load(), LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  // Enquanto um número está pareando: QR e status direto do gateway.
  const pairingId = pairing?.id ?? null;
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pairingId) return;
    let alive = true;
    const tick = async () => {
      const r = await api<{ session: Session; qr: string | null }>(`/api/whatsapp/sessions/${pairingId}`);
      if (!alive) return;
      if (r.ok) {
        setSessions((cur) => (cur ?? []).map((s) => (s.id === pairingId ? r.data.session : s)));
        if (r.data.session.status === "CONNECTED") {
          setPairing(null);
          setNotice({ ok: true, text: t("Number connected. New messages show up in Conversations.") });
          return;
        }
        setPairing((cur) => (cur && cur.id === pairingId ? { id: pairingId, qr: r.data.qr ?? cur.qr } : cur));
      }
      pollRef.current = window.setTimeout(() => void tick(), QR_POLL_MS);
    };
    pollRef.current = window.setTimeout(() => void tick(), 1_000);
    return () => {
      alive = false;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [pairingId, t]);

  async function reconnect(s: Session) {
    setBusy(true);
    setNotice(null);
    const r = await api<{ session: Session; qr: string | null }>(`/api/whatsapp/sessions/${s.id}/connect`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: t(r.error) });
    setSessions((cur) => (cur ?? []).map((x) => (x.id === s.id ? r.data.session : x)));
    setPairing({ id: s.id, qr: r.data.qr });
  }

  async function disconnect(s: Session) {
    setBusy(true);
    const r = await api<{ session: Session; gatewayOk: boolean }>(`/api/whatsapp/sessions/${s.id}/disconnect`, { method: "POST" });
    setBusy(false);
    setConfirmOff(null);
    if (!r.ok) return setNotice({ ok: false, text: t(r.error) });
    setSessions((cur) => (cur ?? []).map((x) => (x.id === s.id ? r.data.session : x)));
    if (pairing?.id === s.id) setPairing(null);
    setNotice({
      ok: r.data.gatewayOk,
      text: r.data.gatewayOk
        ? t("Number disconnected. Conversations, contacts and settings stay saved.")
        : t("The number is marked as disconnected here, but the gateway did not answer. Conversations, contacts and settings stay saved."),
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-foreground">{t("WhatsApp")}</h1>
        <WhatsAppTabs active="connections" />
      </div>

      <ServerNotice status={server} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-muted">
          {t("Connect a WhatsApp number by reading the QR code with the phone. Disconnecting never deletes conversations, contacts or settings.")}
        </p>
        <button type="button" className={`${btnPrimary} shrink-0`} onClick={() => setShowNew(true)} disabled={showNew}>
          {t("Connect number")}
        </button>
      </div>

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-sm ${notice.ok ? "bg-success/10 text-success" : "bg-error/10 text-error"}`} role="status">
          {notice.text}
        </p>
      )}

      {showNew && (
        <NewNumberCard
          onCancel={() => setShowNew(false)}
          onCreated={(session, qr) => {
            setShowNew(false);
            setSessions((cur) => [...(cur ?? []).filter((s) => s.id !== session.id), session]);
            setPairing({ id: session.id, qr });
          }}
        />
      )}

      {sessions === null && !loadError && <div className="panel h-40 animate-pulse rounded-xl" />}
      {loadError && <div className="rounded-xl border border-error/20 bg-error/10 p-4 text-sm text-error">{loadError}</div>}
      {sessions && sessions.length === 0 && !showNew && (
        <div className="panel rounded-xl p-6 text-center">
          <p className="text-sm font-semibold">{t("No WhatsApp number connected yet")}</p>
          <p className="mt-1 text-sm text-muted">{t("Use a dedicated number, never your main one: WhatsApp can ban numbers connected this way.")}</p>
        </div>
      )}

      <div className="space-y-4">
        {(sessions ?? []).map((s) => (
          <article key={s.id} className="panel overflow-hidden rounded-xl">
            <div className="flex items-start gap-4 p-4 sm:p-5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#25d366] text-white" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.4z" />
                  <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.4-1.8-1.2-2.2-2.2l1-1-1-2z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="truncate text-base font-semibold">{s.displayName || formatPhone(s.phoneE164) || t("New number")}</p>
                  <StatusPill status={s.status} />
                </div>
                <p className="truncate text-sm text-muted">{s.phoneE164 ? formatPhone(s.phoneE164) : t("The number shows up after you read the QR code.")}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {t("{c} conversations, {m} messages saved", { c: s.conversationCount, m: s.messageCount })}
                  {s.provider === "OPENWA" ? ` · ${t("QR code (experimental)")}` : ` · ${t("Official API")}`}
                </p>
              </div>
            </div>

            {pairing?.id === s.id && <QrBox qr={pairing.qr} status={s.status} />}

            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
              {s.status !== "CONNECTED" && pairing?.id !== s.id && s.provider === "OPENWA" && (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void reconnect(s)}>
                  {t("Show QR code")}
                </button>
              )}
              {pairing?.id === s.id && (
                <button type="button" className={btnSecondary} onClick={() => setPairing(null)}>
                  {t("Hide QR code")}
                </button>
              )}
              {s.status !== "DISCONNECTED" && (
                <button type="button" className={btnDanger} disabled={busy} onClick={() => setConfirmOff(s)}>
                  {t("Disconnect")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {confirmOff && (
        <ConfirmBox
          title={t("Disconnect this number?")}
          danger
          busy={busy}
          confirmLabel={t("Disconnect")}
          onCancel={() => setConfirmOff(null)}
          onConfirm={() => void disconnect(confirmOff)}
          body={
            <>
              <p>{t("The Lead Engine stops receiving and sending messages on this number.")}</p>
              <p className="font-medium text-foreground">{t("Nothing is deleted: conversations, contacts, agents and PDFs stay saved. To use it again, read a new QR code.")}</p>
            </>
          }
        />
      )}
    </div>
  );
}

function QrBox({ qr, status }: { qr: string | null; status: WaStatus }) {
  const t = useT();
  const isImage = Boolean(qr && qr.startsWith("data:image/"));
  return (
    <div className="mx-4 mb-4 grid gap-4 rounded-lg border border-border bg-surface-hover/60 p-4 sm:mx-5 sm:grid-cols-[220px_1fr] sm:items-center">
      <div className="mx-auto grid h-[220px] w-[220px] place-items-center rounded-lg bg-white p-2">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- QR em data URL vindo do gateway
          <img src={qr!} alt={t("QR code to connect WhatsApp")} className="h-full w-full object-contain" />
        ) : (
          <p className="px-4 text-center text-sm text-muted">{status === "CONNECTED" ? t("Connected now") : t("Generating the QR code…")}</p>
        )}
      </div>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
        <li>{t("Open WhatsApp on the phone of this number.")}</li>
        <li>{t("Tap the three dots (Android) or Settings (iPhone) and then Linked devices.")}</li>
        <li>{t("Tap Link a device and point the camera at this code.")}</li>
        <li className="text-muted">{t("The code changes by itself every few seconds. Keep this page open until it says Connected.")}</li>
      </ol>
    </div>
  );
}

function NewNumberCard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (s: Session, qr: string | null) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const r = await api<{ session: Session; qr: string | null }>("/api/whatsapp/sessions", {
      method: "POST",
      body: JSON.stringify({ acceptRisk: accepted, displayName: name }),
    });
    setBusy(false);
    if (!r.ok) return setError(t(r.error));
    onCreated(r.data.session, r.data.qr);
  }

  return (
    <section className="panel space-y-4 rounded-xl p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{t("Connect a number by QR code")}</h2>
        <p className="mt-1 text-sm text-muted">{t("This mode uses WhatsApp Web through our gateway. It is not the official WhatsApp API.")}</p>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("Name to recognize this number (optional)")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("Example: Store service")} className={INPUT} />
      </label>
      <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
        <p className="font-semibold">{t("Before you connect")}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
          <li>{t("WhatsApp does not allow unofficial connections. The number can be restricted or banned, and there is no appeal.")}</li>
          <li>{t("Use a dedicated number, never your personal or main business number.")}</li>
          <li>{t("Never send bulk messages from it. The agents start turned off and only answer people who wrote first.")}</li>
        </ul>
        <label className="mt-3 flex items-start gap-2 text-foreground">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>{t("I understand the risk and this is a dedicated number.")}</span>
        </label>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          {t("Cancel")}
        </button>
        <button type="button" className={btnPrimary} onClick={() => void create()} disabled={!accepted || busy}>
          {busy ? t("Connecting…") : t("Generate QR code")}
        </button>
      </div>
    </section>
  );
}
