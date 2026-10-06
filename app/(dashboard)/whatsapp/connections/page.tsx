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

  const load = useCallback(async () => {
    const r = await api<{ sessions: Session[] }>("/api/whatsapp/sessions");
    if (r.ok) {
      setSessions(r.data.sessions);
      setLoadError(null);
    } else setLoadError(t(r.error));
  }, [t]);

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

            {pairing?.id === s.id && <PairingBox pairing={pairing} status={s.status} />}

            {reconnecting === s.id && s.provider === "UAZAPI" && (
              <ReconnectUazapi busy={busy} onCancel={() => setReconnecting(null)} onConnect={(body) => void reconnect(s, body)} />
            )}

            <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
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
              {confirmOff.provider === "UAZAPI" && <p>{t("On the uazapi the device stays reserved for this number, so you can reconnect it later.")}</p>}
            </>
          }
        />
      )}
    </div>
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
      <div className="grid gap-4 rounded-lg border border-border bg-surface-hover/60 p-4 sm:grid-cols-[220px_1fr] sm:items-center">
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
    <section className="panel space-y-5 rounded-xl p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{t("Connect a number")}</h2>
        <p className="mt-1 text-sm text-muted">{t("Choose how this number connects. Both ways are unofficial (WhatsApp Web), so use a number only for this.")}</p>
      </div>

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
              {t("Not available yet: the uazapi is not configured on the server (UAZAPI_SERVER_URL and UAZAPI_ADMIN_TOKEN).")}
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
            <span className="mt-2 block text-xs text-warning">{t("Not available: the OpenWA gateway is not configured on the server.")}</span>
          )}
        </label>
      </fieldset>

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t("Name to recognize this number (optional)")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("Example: Store service")} className={INPUT} />
      </label>

      {isUazapi && uazapiReady && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-semibold">{t("Where the connection goes out")}</p>
            <p className="mt-0.5 text-sm text-muted">
              {t("Without a city it does not connect. WhatsApp distrusts a Brazilian number that shows up coming from a server abroad. The proxy makes the connection go out through an IP in Brazil.")}
            </p>
          </div>
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
        </div>
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
    </section>
  );
}
