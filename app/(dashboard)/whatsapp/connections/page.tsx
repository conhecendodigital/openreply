"use client";

/**
 * WhatsApp > Conexões (06/10/2026, pedido do dono: "tem que subir, não está
 * aparecendo no painel nem no menu").
 *
 * Conectar número: a pessoa escolhe o provedor. uazapi em destaque (sai por
 * IP do Brasil, com a cidade do proxy escolhida aqui); OpenWA com aviso forte
 * de risco, só pra chip de teste (o número pessoal do dono foi bloqueado 5 s
 * depois de conectar pelo OpenWA, num IP de datacenter).
 * QR que se atualiza sozinho ou código de pareamento (uazapi), estado
 * conectado/desconectado e o número e nome conectados. Desconectar pede
 * confirmação e NUNCA apaga conversas, contatos nem configurações (regra do
 * dono: "não quero que quando canal desconectar já saia apagando tudo"). Só
 * dono ou admin do workspace conecta e desconecta.
 *
 * Excluir número (pedido do dono: "ter a opção de excluir o número nas
 * conexões") é outro botão, só pra dono ou admin, com duas opções: só o número
 * (conversas ficam guardadas, só leitura) ou número e conversas (pede o nome
 * digitado). Números excluídos com conversas guardadas aparecem no fim da
 * página, com a opção de apagar as conversas depois.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CollapsibleSection, SectionIndex, SectionsProvider } from "@/components/ui/collapsible-section";
import { useT } from "@/components/lang-provider";
import {
  api,
  btn,
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
  type ServerStatus,
  type WaStatus,
} from "@/components/whatsapp/ui";

type Provider = "OPENWA" | "CLOUD_API" | "UAZAPI";

type Session = {
  id: string;
  provider: Provider;
  proxy: { country: string; city: string; label: string | null } | null;
  status: WaStatus;
  phoneE164: string | null;
  displayName: string | null;
  connectedAt: string | null;
  lastEventAt: string | null;
  conversationCount: number;
  messageCount: number;
};

type Pairing = { id: string; qr: string | null; pairCode: string | null; proxyWarning?: boolean };

type Overview = { configured: boolean; max: number; used: number; remaining: number; source: "server" | "local" };

type Removed = { id: string; provider: Provider; label: string; phoneE164: string | null; displayName: string | null; deletedAt: string; conversationCount: number; messageCount: number };

type DeleteTarget = { id: string; provider: Provider; label: string; phoneE164: string | null; displayName: string | null; alreadyRemoved: boolean };

type DeleteResponse = { mode: "number_only" | "number_and_conversations"; providerOk: boolean; provider: Provider; providerRef: string; label: string };

/** O que a pessoa digita pra confirmar: o nome, ou o número se não tiver nome (igual ao servidor). */
function confirmLabel(s: { displayName: string | null; phoneE164: string | null }): string {
  return s.displayName?.trim() || s.phoneE164 || "WhatsApp";
}

function sameName(typed: string, s: { displayName: string | null; phoneE164: string | null }): boolean {
  const norm = (v: string) => v.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  const t = norm(typed);
  if (!t) return false;
  if (t === norm(confirmLabel(s))) return true;
  const digits = t.replace(/\D/g, "");
  return Boolean(s.phoneE164 && digits.length >= 8 && digits === s.phoneE164.replace(/\D/g, ""));
}

function providerName(p: Provider): string {
  return p === "UAZAPI" ? "uazapi" : p === "OPENWA" ? "OpenWA" : "Meta";
}

type ConnectResponse = { session: Session; qr: string | null; pairCode?: string | null; proxyWarning?: boolean };

/** O QR do WhatsApp troca a cada ~20 s: a tela pergunta de novo a cada 3 s. */
const QR_POLL_MS = 3_000;
const LIST_POLL_MS = 15_000;

export default function WhatsAppConnectionsPage() {
  const t = useT();
  const server = useServerStatus();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmOff, setConfirmOff] = useState<Session | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [removed, setRemoved] = useState<Removed[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [role, setRole] = useState<string | null>(null);
  // Excluir é só pra dono ou admin do workspace (o servidor confere de novo).
  const canManage = role === "OWNER" || role === "ADMIN";

  const load = useCallback(async () => {
    const r = await api<{ sessions: Session[]; removed?: Removed[] }>("/api/whatsapp/sessions");
    if (r.ok) {
      setSessions(r.data.sessions);
      setRemoved(r.data.removed ?? []);
      setLoadError(null);
    } else setLoadError(t(r.error));
  }, [t]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await api<{ currentUserRole: string }>("/api/workspace/members");
      if (alive && r.ok) setRole(r.data.currentUserRole);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadOverview = useCallback(async () => {
    const r = await api<Overview>("/api/whatsapp/uazapi");
    if (r.ok) setOverview(r.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- primeira carga e atualização periódica da lista
    void load();
    void loadOverview();
    const timer = window.setInterval(() => void load(), LIST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, loadOverview]);

  // Enquanto um número está pareando: QR, código e status direto do provedor.
  const pairingId = pairing?.id ?? null;
  const pollRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pairingId) return;
    let alive = true;
    const tick = async () => {
      const r = await api<{ session: Session; qr: string | null; pairCode?: string | null }>(`/api/whatsapp/sessions/${pairingId}`);
      if (!alive) return;
      if (r.ok) {
        setSessions((cur) => (cur ?? []).map((s) => (s.id === pairingId ? r.data.session : s)));
        if (r.data.session.status === "CONNECTED") {
          setPairing(null);
          setNotice({ ok: true, text: t("Number connected. New messages show up in Conversations.") });
          return;
        }
        setPairing((cur) =>
          cur && cur.id === pairingId ? { ...cur, qr: r.data.qr ?? cur.qr, pairCode: r.data.pairCode ?? cur.pairCode } : cur
        );
      }
      pollRef.current = window.setTimeout(() => void tick(), QR_POLL_MS);
    };
    pollRef.current = window.setTimeout(() => void tick(), 1_000);
    return () => {
      alive = false;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [pairingId, t]);

  async function reconnect(s: Session, body: Record<string, unknown> = {}) {
    setBusy(true);
    setNotice(null);
    const r = await api<ConnectResponse>(`/api/whatsapp/sessions/${s.id}/connect`, { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: t(r.error) });
    setReconnecting(null);
    setSessions((cur) => (cur ?? []).map((x) => (x.id === s.id ? r.data.session : x)));
    setPairing({ id: s.id, qr: r.data.qr, pairCode: r.data.pairCode ?? null, proxyWarning: r.data.proxyWarning });
  }

  async function restart(s: Session) {
    setBusy(true);
    setNotice(null);
    const r = await api<{ session: Session; resetting: boolean }>(`/api/whatsapp/sessions/${s.id}/restart`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: t(r.error) });
    setNotice({ ok: true, text: t("Restarting the connection. It takes a few seconds and needs no new QR code.") });
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

  async function deleteNumber(target: DeleteTarget, mode: "number_only" | "number_and_conversations", confirmName: string) {
    setBusy(true);
    const r = await api<DeleteResponse>(`/api/whatsapp/sessions/${target.id}`, {
      method: "DELETE",
      body: JSON.stringify({ mode, confirmName }),
    });
    setBusy(false);
    if (!r.ok) return setNotice({ ok: false, text: t(r.error) });
    setConfirmDelete(null);
    if (pairing?.id === target.id) setPairing(null);
    if (reconnecting === target.id) setReconnecting(null);
    setSessions((cur) => (cur ?? []).filter((x) => x.id !== target.id));
    void load();
    void loadOverview();
    const name = providerName(r.data.provider);
    setNotice(
      !r.data.providerOk
        ? {
            ok: false,
            text: t("The number left the Lead Engine, but the {provider} did not answer. Check the {provider} panel and delete it there too (id {ref}).", {
              provider: name,
              ref: r.data.providerRef,
            }),
          }
        : mode === "number_only"
          ? { ok: true, text: t("Number deleted. Its conversations stay saved in Conversations, only for reading.") }
          : { ok: true, text: target.alreadyRemoved ? t("Saved conversations deleted.") : t("Number and conversations deleted.") }
    );
  }

  const sectionCount = (sessions?.length ?? 0) + (showNew ? 1 : 0) + (removed.length > 0 ? 1 : 0);

  return (
    <SectionsProvider page="whatsapp-conexoes">
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold text-foreground">{t("WhatsApp")}</h1>
        <WhatsAppTabs active="connections" />
      </div>
      {sectionCount > 2 && <SectionIndex />}

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
          server={server}
          overview={overview}
          onCancel={() => setShowNew(false)}
          onCreated={(res) => {
            setShowNew(false);
            setSessions((cur) => [...(cur ?? []).filter((s) => s.id !== res.session.id), res.session]);
            setPairing({ id: res.session.id, qr: res.qr, pairCode: res.pairCode ?? null, proxyWarning: res.proxyWarning });
            void loadOverview();
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
          <CollapsibleSection
            key={s.id}
            id={`numero-${s.id}`}
            className="overflow-hidden"
            title={
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#25d366] text-white" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.4z" />
                    <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.4-1.8-1.2-2.2-2.2l1-1-1-2z" />
                  </svg>
                </span>
                <span className="truncate">{s.displayName || formatPhone(s.phoneE164) || t("New number")}</span>
              </span>
            }
            indexLabel={s.displayName || formatPhone(s.phoneE164) || t("New number")}
            summary={[s.phoneE164 ? formatPhone(s.phoneE164) : "", t("{c} conversations, {m} messages saved", { c: s.conversationCount, m: s.messageCount })].filter(Boolean).join(" · ")}
            attention={pairing?.id === s.id || reconnecting === s.id || s.status === "RESTRICTED" || s.status === "BANNED" || s.status === "QR_READY"}
            actions={<StatusPill status={s.status} />}
          >
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted">{s.phoneE164 ? formatPhone(s.phoneE164) : t("The number shows up after you read the QR code.")}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {t("{c} conversations, {m} messages saved", { c: s.conversationCount, m: s.messageCount })}
                  {" · "}
                  {s.provider === "UAZAPI"
                    ? s.proxy
                      ? t("uazapi, Brazilian IP ({city})", { city: s.proxy.label || s.proxy.city })
                      : t("uazapi")
                    : s.provider === "OPENWA"
                      ? t("QR code (experimental)")
                      : t("Official API")}
                </p>
              </div>
            </div>

            {pairing?.id === s.id && <div className="-mx-4 sm:-mx-5"><PairingBox pairing={pairing} status={s.status} /></div>}

            {reconnecting === s.id && s.provider === "UAZAPI" && (
              <div className="-mx-4 sm:-mx-5"><ReconnectUazapi busy={busy} onCancel={() => setReconnecting(null)} onConnect={(body) => void reconnect(s, body)} /></div>
            )}

            <div className="-mx-4 flex flex-wrap gap-2 border-t border-border px-4 pt-3 sm:-mx-5 sm:px-5">
              {s.status !== "CONNECTED" && pairing?.id !== s.id && s.provider === "OPENWA" && (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => void reconnect(s)}>
                  {t("Show QR code")}
                </button>
              )}
              {s.status !== "CONNECTED" && pairing?.id !== s.id && s.provider === "UAZAPI" && reconnecting !== s.id && (
                <button type="button" className={btnPrimary} disabled={busy} onClick={() => setReconnecting(s.id)}>
                  {t("Connect again")}
                </button>
              )}
              {pairing?.id === s.id && (
                <button type="button" className={btnSecondary} onClick={() => setPairing(null)}>
                  {pairing.pairCode ? t("Hide code") : t("Hide QR code")}
                </button>
              )}
              {s.provider === "UAZAPI" && s.status === "CONNECTED" && (
                <button type="button" className={btnSecondary} disabled={busy} onClick={() => void restart(s)}>
                  {t("Restart connection")}
                </button>
              )}
              {s.status !== "DISCONNECTED" && (
                <button type="button" className={btnDanger} disabled={busy} onClick={() => setConfirmOff(s)}>
                  {t("Disconnect")}
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  className={`${btn} ml-auto text-error hover:bg-error/10`}
                  disabled={busy}
                  onClick={() =>
                    setConfirmDelete({ id: s.id, provider: s.provider, label: confirmLabel(s), phoneE164: s.phoneE164, displayName: s.displayName, alreadyRemoved: false })
                  }
                >
                  {t("Delete number")}
                </button>
              )}
            </div>
          </CollapsibleSection>
        ))}
      </div>

      {removed.length > 0 && (
        <CollapsibleSection
          id="numeros-excluidos"
          title={t("Deleted numbers with saved conversations")}
          defaultOpen={false}
          badge={{ text: String(removed.length) }}
          summary={t("These numbers left Connections. Their conversations stay in Conversations, only for reading.")}
          description={t("These numbers left Connections. Their conversations stay in Conversations, only for reading.")}
        >
          <ul className="divide-y divide-border rounded-lg border border-border">
            {removed.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.displayName || formatPhone(r.phoneE164) || "WhatsApp"}</p>
                  <p className="text-xs text-muted">
                    {t("Deleted on {date}", { date: new Date(r.deletedAt).toLocaleDateString() })}
                    {" · "}
                    {t("{c} conversations, {m} messages saved", { c: r.conversationCount, m: r.messageCount })}
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    className={btnDanger}
                    disabled={busy}
                    onClick={() =>
                      setConfirmDelete({ id: r.id, provider: r.provider, label: r.label, phoneE164: r.phoneE164, displayName: r.displayName, alreadyRemoved: true })
                    }
                  >
                    {t("Delete saved conversations")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {confirmDelete && (
        <DeleteNumberDialog
          key={confirmDelete.id}
          target={confirmDelete}
          busy={busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={(mode, name) => void deleteNumber(confirmDelete, mode, name)}
        />
      )}

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
              {confirmOff.provider === "UAZAPI" && <p>{t("On the uazapi the device stays reserved for this number, so you can reconnect it later.")}</p>}
            </>
          }
        />
      )}
    </div>
    </SectionsProvider>
  );
}

/**
 * Confirmação do Excluir número. Duas opções; a que apaga as conversas só
 * libera o botão depois de digitar o nome do número.
 */
function DeleteNumberDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (mode: "number_only" | "number_and_conversations", confirmName: string) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"number_only" | "number_and_conversations">(target.alreadyRemoved ? "number_and_conversations" : "number_only");
  const [typed, setTyped] = useState("");
  const wipe = mode === "number_and_conversations";
  const nameOk = sameName(typed, target);
  const provider = providerName(target.provider);
  return (
    <ConfirmBox
      title={target.alreadyRemoved ? t("Delete the saved conversations?") : t("Delete this number?")}
      danger
      busy={busy}
      confirmDisabled={wipe && !nameOk}
      confirmLabel={wipe ? (target.alreadyRemoved ? t("Delete conversations") : t("Delete number and conversations")) : t("Delete only the number")}
      onCancel={onCancel}
      onConfirm={() => onConfirm(mode, typed)}
      body={
        <>
          {target.alreadyRemoved ? (
            <p>{t("Deletes the conversations, messages, media, webhook events and the agent memory and drafts of this number. Other numbers and Instagram are not touched. You cannot undo this.")}</p>
          ) : (
            <fieldset className="space-y-2">
              <legend className="sr-only">{t("What do you want to delete?")}</legend>
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${!wipe ? "border-accent bg-accent/5" : "border-border"}`}>
                <input type="radio" name="wa-delete-mode" className="mt-1 h-4 w-4" checked={!wipe} onChange={() => setMode("number_only")} />
                <span>
                  <span className="block font-semibold text-foreground">{t("Delete only the number")}</span>
                  <span className="block">
                    {t("The number leaves the {provider} and disappears from Connections. Conversations, contacts and messages stay saved: you can still read them in Conversations, but you cannot send from this number anymore.", { provider })}
                  </span>
                </span>
              </label>
              <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${wipe ? "border-error bg-error/5" : "border-border"}`}>
                <input type="radio" name="wa-delete-mode" className="mt-1 h-4 w-4" checked={wipe} onChange={() => setMode("number_and_conversations")} />
                <span>
                  <span className="block font-semibold text-foreground">{t("Delete number and conversations")}</span>
                  <span className="block">
                    {t("The same, and it also deletes the conversations, messages, media, webhook events and the agent memory and drafts of this number. Other numbers and Instagram are not touched. You cannot undo this.")}
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          {!target.alreadyRemoved && target.provider === "UAZAPI" && <p>{t("On the uazapi, the device of your plan is free again.")}</p>}
          {wipe && (
            <label className="block space-y-1">
              <span className="text-foreground">{t("To confirm, type the name of the number: {name}", { name: target.label })}</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                maxLength={120}
                autoComplete="off"
                aria-label={t("Name of the number")}
                className={INPUT}
              />
            </label>
          )}
          {!target.alreadyRemoved && <p className="text-xs">{t("If you only want to stop using it for a while, use Disconnect: it deletes nothing.")}</p>}
        </>
      }
    />
  );
}

function PairingBox({ pairing, status }: { pairing: Pairing; status: WaStatus }) {
  const t = useT();
  const { qr, pairCode } = pairing;
  const isImage = Boolean(qr && qr.startsWith("data:image/"));
  return (
    <div className="mx-4 mb-4 space-y-3 sm:mx-5">
      {pairing.proxyWarning && (
        <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error" role="alert">
          {t("The uazapi says this connection is going out without the proxy. Disconnect before reading the code and talk to the uazapi support.")}
        </p>
      )}
      <div className="grid gap-4 rounded-lg border border-border bg-surface-hover/60 p-4 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
        {pairCode ? (
          <div className="mx-auto grid h-[160px] w-[220px] place-items-center rounded-lg bg-white p-3">
            <p className="whitespace-nowrap font-mono text-2xl font-bold tracking-[0.12em] text-zinc-900" aria-label={t("Pairing code")}>
              {pairCode}
            </p>
          </div>
        ) : (
          <div className="mx-auto grid h-[220px] w-[220px] place-items-center rounded-lg bg-white p-2">
            {isImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- QR em data URL vindo do provedor
              <img src={qr!} alt={t("QR code to connect WhatsApp")} className="h-full w-full object-contain" />
            ) : (
              <p className="px-4 text-center text-sm text-muted">{status === "CONNECTED" ? t("Connected now") : t("Generating the QR code…")}</p>
            )}
          </div>
        )}
        {pairCode ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
            <li>{t("Open WhatsApp on the phone of this number.")}</li>
            <li>{t("Tap the three dots (Android) or Settings (iPhone) and then Linked devices.")}</li>
            <li>{t("Tap Link a device and then Link with phone number instead.")}</li>
            <li>{t("Type this code on the phone.")}</li>
            <li className="text-muted">{t("Keep this page open until it says Connected.")}</li>
          </ol>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-foreground">
            <li>{t("Open WhatsApp on the phone of this number.")}</li>
            <li>{t("Tap the three dots (Android) or Settings (iPhone) and then Linked devices.")}</li>
            <li>{t("Tap Link a device and point the camera at this code.")}</li>
            <li className="text-muted">{t("The code changes by itself every few seconds. Keep this page open until it says Connected.")}</li>
          </ol>
        )}
      </div>
    </div>
  );
}

/** QR ou código de pareamento (só a uazapi tem os dois). */
function MethodPicker({
  method,
  phone,
  onMethod,
  onPhone,
}: {
  method: "qr" | "code";
  phone: string;
  onMethod: (m: "qr" | "code") => void;
  onPhone: (p: string) => void;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t("How do you want to connect?")}</legend>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="wa-method" checked={method === "qr"} onChange={() => onMethod("qr")} className="h-4 w-4" />
          <span>{t("QR code (read with the phone camera)")}</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="wa-method" checked={method === "code"} onChange={() => onMethod("code")} className="h-4 w-4" />
          <span>{t("Pairing code (type a code on the phone)")}</span>
        </label>
      </div>
      {method === "code" && (
        <label className="block space-y-1">
          <span className="text-sm">{t("Number of this WhatsApp, with country and area code")}</span>
          <input
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
            inputMode="tel"
            maxLength={20}
            placeholder="55 11 91234-5678"
            className={INPUT}
          />
        </label>
      )}
    </fieldset>
  );
}

function ReconnectUazapi({ busy, onCancel, onConnect }: { busy: boolean; onCancel: () => void; onConnect: (body: Record<string, unknown>) => void }) {
  const t = useT();
  const [method, setMethod] = useState<"qr" | "code">("qr");
  const [phone, setPhone] = useState("");
  return (
    <div className="mx-4 mb-4 space-y-3 rounded-lg border border-border bg-surface-hover/60 p-4 sm:mx-5">
      <p className="text-sm text-muted">{t("It connects again on the same device and the same city of the proxy.")}</p>
      <MethodPicker method={method} phone={phone} onMethod={setMethod} onPhone={setPhone} />
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          {t("Cancel")}
        </button>
        <button
          type="button"
          className={btnPrimary}
          disabled={busy || (method === "code" && phone.replace(/\D/g, "").length < 10)}
          onClick={() => onConnect({ method, phone })}
        >
          {method === "code" ? t("Generate code") : t("Generate QR code")}
        </button>
      </div>
    </div>
  );
}

type Region = { value: string; label: string; state?: string | null; stateLabel?: string | null };

function NewNumberCard({
  server,
  overview,
  onCancel,
  onCreated,
}: {
  server: ServerStatus | null;
  overview: Overview | null;
  onCancel: () => void;
  onCreated: (res: ConnectResponse) => void;
}) {
  const t = useT();
  const uazapiReady = Boolean(server?.uazapiConfigured && overview?.configured);
  const openwaReady = Boolean(server?.gatewayConfigured);
  const noSlots = Boolean(overview?.configured && overview.remaining <= 0);
  const [provider, setProvider] = useState<"UAZAPI" | "OPENWA">("UAZAPI");
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [method, setMethod] = useState<"qr" | "code">("qr");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("br");
  const [city, setCity] = useState("");
  const [countries, setCountries] = useState<Region[]>([]);
  const [cities, setCities] = useState<Region[] | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lista de países e cidades vem da própria uazapi (Brasil já vem escolhido).
  useEffect(() => {
    if (provider !== "UAZAPI" || !uazapiReady) return;
    let alive = true;
    void (async () => {
      const r = await api<{ countries: Region[]; country: string; cities: Region[] }>(`/api/whatsapp/uazapi/regions?country=${encodeURIComponent(country)}`);
      if (!alive) return;
      if (!r.ok) {
        setRegionError(t(r.error));
        setCities([]);
        return;
      }
      setRegionError(null);
      if (r.data.countries.length) setCountries(r.data.countries);
      setCities(r.data.cities);
    })();
    return () => {
      alive = false;
    };
  }, [provider, uazapiReady, country, t]);

  const isUazapi = provider === "UAZAPI";
  const proxyOk = !isUazapi || Boolean(city);
  const phoneOk = !isUazapi || method === "qr" || phone.replace(/\D/g, "").length >= 10;
  const providerOk = isUazapi ? uazapiReady && !noSlots : openwaReady;
  const canSubmit = accepted && proxyOk && phoneOk && providerOk && !busy;

  async function create() {
    setBusy(true);
    setError(null);
    const body = isUazapi
      ? { provider: "UAZAPI", acceptRisk: accepted, displayName: name, method, phone, proxy: { country, city } }
      : { provider: "OPENWA", acceptRisk: accepted, displayName: name };
    const r = await api<ConnectResponse>("/api/whatsapp/sessions", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) return setError(t(r.error));
    onCreated(r.data);
  }

  const cityLabel = (c: Region) => (c.state ? `${c.label} (${c.state.toUpperCase()})` : c.label);

  return (
    <CollapsibleSection
      id="conectar"
      title={t("Connect a number")}
      attention={Boolean(error)}
      summary={isUazapi ? (city ? t("uazapi, Brazilian IP ({city})", { city }) : t("uazapi")) : t("QR code (experimental)")}
      description={t("Choose how this number connects. Both ways are unofficial (WhatsApp Web), so use a number only for this.")}
    >
      <div className="space-y-5">

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="sr-only">{t("Provider")}</legend>
        <label
          className={`relative block cursor-pointer rounded-xl border-2 p-4 text-sm transition-colors ${
            isUazapi && uazapiReady ? "border-accent bg-accent/5" : "border-border"
          } ${uazapiReady ? "" : "cursor-not-allowed opacity-70"}`}
        >
          <input
            type="radio"
            name="wa-provider"
            className="sr-only"
            checked={isUazapi}
            disabled={!uazapiReady}
            onChange={() => setProvider("UAZAPI")}
          />
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">uazapi</span>
            <span className="rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">{t("recommended: goes out through an IP in Brazil")}</span>
          </span>
          <span className="mt-1 block text-muted">{t("The connection goes out through a proxy in the Brazilian city you choose, like a phone at home.")}</span>
          {uazapiReady && overview && (
            <span className={`mt-2 block text-xs font-medium ${noSlots ? "text-error" : "text-foreground"}`}>
              {noSlots
                ? t("No free device in your uazapi plan ({used} of {max} in use).", { used: overview.used, max: overview.max })
                : t("{n} of {max} devices free in your uazapi plan", { n: overview.remaining, max: overview.max })}
            </span>
          )}
          {uazapiReady && noSlots && (
            <span className="mt-1 block text-xs text-muted">{t("A disconnected number still uses its device: use Connect again on it.")}</span>
          )}
          {!uazapiReady && (
            <span className="mt-2 block text-xs text-warning">
              {t("Not available yet: the uazapi is not configured (Channels, Connections and keys).")}
            </span>
          )}
        </label>

        <label
          className={`relative block cursor-pointer rounded-xl border-2 p-4 text-sm transition-colors ${
            !isUazapi ? "border-error bg-error/5" : "border-border"
          } ${openwaReady ? "" : "cursor-not-allowed opacity-70"}`}
        >
          <input
            type="radio"
            name="wa-provider"
            className="sr-only"
            checked={!isUazapi}
            disabled={!openwaReady}
            onChange={() => setProvider("OPENWA")}
          />
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">OpenWA</span>
            <span className="rounded-full bg-error/15 px-2 py-0.5 text-xs font-semibold text-error">{t("high risk: test SIM only")}</span>
          </span>
          <span className="mt-1 block text-muted">{t("Goes out through the IP of a data center. A personal number was banned 5 seconds after connecting this way.")}</span>
          {!openwaReady && (
            <span className="mt-2 block text-xs text-warning">{t("Not available: the OpenWA gateway is not configured (Channels, Connections and keys).")}</span>
          )}
        </label>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("Name to recognize this number (optional)")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("Example: Store service")} className={INPUT} />
      </label>

      {isUazapi && uazapiReady && (
        <CollapsibleSection
          id="conectar-saida"
          variant="group"
          hideFromIndex
          title={t("Where the connection goes out")}
          attention={Boolean(regionError)}
          summary={city ? cityLabel((cities ?? []).find((c) => c.value === city) ?? { value: city, label: city }) : t("Choose the city")}
          badge={city ? null : { text: t("Choose the city"), tone: "warning" }}
          description={t("Without a city it does not connect. WhatsApp distrusts a Brazilian number that shows up coming from a server abroad. The proxy makes the connection go out through an IP in Brazil.")}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm">{t("Country")}</span>
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setCity("");
                  setCities(null);
                }}
                className={INPUT}
              >
                {(countries.length ? countries : [{ value: "br", label: "Brazil" }]).map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.value === "br" ? t("Brazil") : c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-sm">{t("City")}</span>
              <select value={city} onChange={(e) => setCity(e.target.value)} className={INPUT} disabled={!cities || cities.length === 0}>
                <option value="">{cities === null ? t("Loading cities…") : t("Choose the city")}</option>
                {(cities ?? []).map((c) => (
                  <option key={c.value} value={c.value}>
                    {cityLabel(c)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {country !== "br" && <p className="text-xs text-warning">{t("For a Brazilian number, keep Brazil.")}</p>}
          {regionError && <p className="text-sm text-error">{regionError}</p>}
          <MethodPicker method={method} phone={phone} onMethod={setMethod} onPhone={setPhone} />
        </CollapsibleSection>
      )}

      <div className={`rounded-lg border p-3 text-sm ${isUazapi ? "border-warning/30 bg-warning/10" : "border-error/40 bg-error/10"}`}>
        <p className="font-semibold">{isUazapi ? t("Before you connect") : t("Strong warning: high risk of ban")}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
          <li>{t("WhatsApp does not allow unofficial connections. The number can be restricted or banned, and there is no appeal.")}</li>
          <li>{t("Use a dedicated number, never your personal or main business number.")}</li>
          {!isUazapi && <li className="font-medium text-error">{t("OpenWA only with a test SIM you can lose.")}</li>}
          <li>{t("Never send bulk messages from it. The agents start turned off and only answer people who wrote first.")}</li>
        </ul>
        <label className="mt-3 flex items-start gap-2 text-foreground">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>{t("I understand the risk and this is a number only for this, never the personal one.")}</span>
        </label>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
          {t("Cancel")}
        </button>
        <button type="button" className={btnPrimary} onClick={() => void create()} disabled={!canSubmit}>
          {busy ? t("Connecting…") : isUazapi && method === "code" ? t("Generate code") : t("Generate QR code")}
        </button>
      </div>
      </div>
    </CollapsibleSection>
  );
}
