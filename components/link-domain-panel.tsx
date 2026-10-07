"use client";

/**
 * Canais > Conexões e chaves > Domínio dos links (07/10/2026). Pedido do
 * dono: o link da DM era enorme e com a marca do Lead Engine.
 *
 * The owner types a domain of their own (comando.cloudmatheus.com.br). Saving
 * checks that the domain already reaches this Lead Engine; from then on the
 * DMs carry https://<domain>/r/<slug>/<code>. Removing it sends the next DMs
 * on the app's own address. Links already sent keep working on both.
 */

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

type View = { domain: string | null; appUrl: string; linkBase: string };

const inputClass =
  "w-full rounded border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40";
const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50";
const btnPrimary = `${btn} bg-accent text-white hover:bg-accent-hover`;
const btnDanger = `${btn} border border-error/30 text-error hover:bg-error/10`;

export function LinkDomainPanel() {
  const t = useT();
  const [data, setData] = useState<View | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/workspace/link-domain", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (payload?.success) {
          setData(payload.data);
          setValue(payload.data.domain ?? "");
        } else setError(t("Could not load these settings."));
      })
      .catch(() => setError(t("Could not load these settings.")));
  }, [t]);

  function errorText(code: string | undefined): string {
    switch (code) {
      case "domain_invalid":
        return t("This does not look like a domain. Type only the address, like comando.yoursite.com.");
      case "domain_internal":
        return t("Use a public domain of yours, not a local or internal name.");
      case "domain_app":
        return t("This is already the Lead Engine address. Type a domain of yours.");
      case "domain_taken":
        return t("Another workspace already uses this domain.");
      case "domain_not_pointed":
        return t("This domain does not reach the Lead Engine yet. Point it here first (DNS, Cloudflare and Dokploy) and try again.");
      case "rate_limited":
        return t("Too many changes. Wait a few minutes.");
      case "forbidden":
        return t("Only owners and admins can change this.");
      default:
        return t("Could not save. Try again.");
    }
  }

  async function save(domain: string | null) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/workspace/link-domain", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const payload = await res.json().catch(() => null);
      if (!payload?.success) {
        setError(errorText(payload?.code));
        return;
      }
      setData(payload.data);
      setValue(payload.data.domain ?? "");
      setSaved(true);
    } catch {
      setError(t("Could not save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!confirm(t("Stop using this domain? The next DMs go with the Lead Engine address. Links already sent keep working."))) return;
    void save(null);
  }

  const domain = data?.domain ?? null;
  const example = `${data?.linkBase ?? ""}/r/abc123/k3J9xQ2`;

  return (
    <CollapsibleSection
      id="conexao-links"
      variant="group"
      hideFromIndex
      defaultOpen={false}
      title={t("Link domain")}
      badge={domain ? { text: t("Configured"), tone: "success" } : { text: t("Not configured"), tone: "default" }}
      summary={domain ?? t("Links use the Lead Engine address")}
    >
      <p className="mb-4 text-sm text-muted">
        {t("The link that goes in the DM uses this domain, short: one code per person. Point the domain to the Lead Engine first (DNS, Cloudflare and Dokploy), then save it here.")}
      </p>
      {error && <div className="mb-3 rounded-lg border border-error/20 bg-error/10 p-3 text-sm text-error">{error}</div>}
      {saved && !error && (
        <div className="mb-3 rounded-lg border border-success/25 bg-success/10 p-3 text-sm">{t("Saved. The next DMs go with this domain.")}</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(value.trim() || null);
        }}
        className="space-y-3"
      >
        <label htmlFor="link-domain" className="block text-sm font-medium text-foreground">
          {t("Domain")}
        </label>
        <input
          id="link-domain"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={253}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="comando.yoursite.com"
          className={inputClass}
        />
        {data && (
          <p className="break-all text-xs text-muted">
            {t("How the link looks:")} <span className="font-mono">{example}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy || !value.trim() || value.trim() === domain} className={btnPrimary}>
            {busy ? t("Checking...") : t("Save")}
          </button>
          {domain && (
            <button type="button" onClick={remove} disabled={busy} className={btnDanger}>
              {t("Remove")}
            </button>
          )}
        </div>
      </form>
    </CollapsibleSection>
  );
}
