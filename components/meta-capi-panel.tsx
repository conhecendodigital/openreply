"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";

/**
 * Settings section: account Pixel + Meta Conversions API. Only owners and
 * admins see it (the API answers 403 to anyone else and to API keys).
 * The token is typed here once; after saving, the screen only knows its last
 * 4 characters.
 */

interface MetaCapiView {
  pixelId: string | null;
  tokenSaved: boolean;
  tokenLast4: string | null;
  testEventCode: string | null;
}

type TestResult =
  | { ok: true; eventsReceived: number; testEventCode: boolean }
  | { ok: false; code: string; message?: string; testEventCode: boolean };

const PIXEL_RE = /^\d{5,20}$/;

const inputClass =
  "w-full rounded border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent/40";

export function MetaCapiPanel() {
  const t = useT();
  const [data, setData] = useState<MetaCapiView | null>(null);
  const [pixelId, setPixelId] = useState("");
  const [testCode, setTestCode] = useState("");
  const [token, setToken] = useState("");
  const [editingToken, setEditingToken] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  function apply(view: MetaCapiView) {
    setData(view);
    setPixelId(view.pixelId ?? "");
    setTestCode(view.testEventCode ?? "");
  }

  useEffect(() => {
    fetch("/api/workspace/meta-capi")
      .then((res) => res.json())
      .then((payload) => {
        if (payload?.success) apply(payload.data);
        else setError(t("Could not load these settings."));
      })
      .catch(() => setError(t("Could not load these settings.")));
  }, [t]);

  function errorText(code: string | undefined): string {
    switch (code) {
      case "pixel_invalid":
        return t("The Pixel ID must have only digits (5 to 20)");
      case "token_invalid":
        return t("This token does not look like a Meta token. Copy it again from the Events Manager.");
      case "test_code_invalid":
        return t("The test event code has only letters and numbers, like TEST12345.");
      case "forbidden":
        return t("Only owners and admins can change this.");
      default:
        return t("Could not save. Try again.");
    }
  }

  async function save(body: Record<string, string | null>, key: string): Promise<boolean> {
    setBusy(key);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/workspace/meta-capi", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => null);
      if (!payload?.success) {
        setError(errorText(payload?.code));
        return false;
      }
      apply(payload.data);
      setSaved(true);
      return true;
    } catch {
      setError(t("Could not save. Try again."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const pixel = pixelId.replace(/\s/g, "");
    if (pixel && !PIXEL_RE.test(pixel)) {
      setError(errorText("pixel_invalid"));
      return;
    }
    const body: Record<string, string | null> = { pixelId: pixel || null, testEventCode: testCode.trim() || null };
    if (token.trim()) body.accessToken = token.trim();
    if (await save(body, "save")) {
      setToken("");
      setEditingToken(false);
      setTest(null);
    }
  }

  async function removeToken() {
    if (!confirm(t("Remove the Conversions API token? The quizzes stop sending events from the server. The Pixel in the browser keeps working."))) {
      return;
    }
    if (await save({ accessToken: null }, "remove")) setTest(null);
  }

  async function sendTest() {
    setBusy("test");
    setTest(null);
    try {
      const res = await fetch("/api/workspace/meta-capi/test", { method: "POST" });
      const payload = await res.json().catch(() => null);
      setTest(payload?.success ? payload.data : { ok: false, code: "network", testEventCode: false });
    } catch {
      setTest({ ok: false, code: "network", testEventCode: false });
    } finally {
      setBusy(null);
    }
  }

  function testErrorText(result: Extract<TestResult, { ok: false }>): string {
    switch (result.code) {
      case "not_configured":
        return t("Save the Pixel ID and the token first.");
      case "invalid_token":
        return t("Meta did not accept the token. It may be wrong or expired. Generate a new one in the Events Manager and save it again.");
      case "pixel_not_found":
        return t("Meta did not find this Pixel, or the token has no access to it. Check the Pixel ID.");
      case "permission":
        return t("The token has no permission for this Pixel. Generate the token inside this Pixel's settings in the Events Manager.");
      case "timeout":
        return t("Meta took too long to answer. Try again in a moment.");
      case "network":
        return t("Could not reach Meta right now. Try again.");
      default:
        return t("Meta refused the event.");
    }
  }

  const tokenSaved = Boolean(data?.tokenSaved);
  const showTokenInput = !tokenSaved || editingToken;
  const ready = tokenSaved && Boolean(data?.pixelId);

  return (
    <section className="panel rounded p-4 sm:p-6">
      <h2 className="mb-2 text-base font-semibold">{t("Meta Pixel and Conversions API")}</h2>
      <p className="mb-6 text-sm text-muted">
        {t("The quizzes send Lead, InitiateCheckout and the Hotmart Purchase to Meta from the server too, with the same event id as the Pixel in the browser, so nothing is counted twice. It only sends when the visitor accepted the cookies (or when the quiz only informs).")}
      </p>

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label htmlFor="capi-pixel" className="mb-1 block text-sm font-medium text-foreground">
            {t("Default Pixel ID")}
          </label>
          <input
            id="capi-pixel"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={20}
            value={pixelId}
            onChange={(e) => setPixelId(e.target.value.replace(/\s/g, ""))}
            placeholder="123456789012345"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            {t("Only the number. A quiz without its own Pixel uses this one.")}
          </p>
        </div>

        <div>
          <label htmlFor="capi-token" className="mb-1 block text-sm font-medium text-foreground">
            {t("Conversions API access token")}
          </label>
          {showTokenInput ? (
            <>
              <input
                id="capi-token"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t("Paste the token here")}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-muted">
                {t("In the Events Manager: your Pixel, Settings, Conversions API, Generate access token. It is saved encrypted and never shown again.")}
              </p>
              {editingToken && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingToken(false);
                    setToken("");
                  }}
                  className="mt-2 text-xs font-medium text-muted hover:text-foreground"
                >
                  {t("Keep the saved token")}
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3 rounded border border-border bg-surface/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-foreground">
                {t("Token saved, ends in ••••{last4}", { last4: data?.tokenLast4 ?? "" })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingToken(true)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
                >
                  {t("Change")}
                </button>
                <button
                  type="button"
                  onClick={() => void removeToken()}
                  disabled={busy === "remove"}
                  className="rounded-lg border border-error/20 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                >
                  {t("Remove")}
                </button>
              </div>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="capi-test-code" className="mb-1 block text-sm font-medium text-foreground">
            {t("Test event code (optional)")}
          </label>
          <input
            id="capi-test-code"
            type="text"
            autoComplete="off"
            maxLength={60}
            value={testCode}
            onChange={(e) => setTestCode(e.target.value.trim())}
            placeholder="TEST12345"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-muted">
            {t("From the Test events tab of the Events Manager. While it is filled, the events show up there to check. Clear it when you are done.")}
          </p>
        </div>

        {error && <p className="text-sm text-error">{error}</p>}
        {saved && !error && <p className="text-sm text-success">{t("Saved.")}</p>}

        <div className="flex flex-wrap gap-3 border-t border-border pt-4">
          <button
            type="submit"
            disabled={busy === "save" || !data}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === "save" ? t("Saving...") : t("Save")}
          </button>
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={!ready || busy === "test"}
            className="rounded border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {busy === "test" ? t("Sending...") : t("Send test event")}
          </button>
        </div>

        {test && (
          <div
            role="status"
            className={`rounded border p-3 text-sm ${test.ok ? "border-success/30 bg-success/10 text-success" : "border-error/30 bg-error/10 text-error"}`}
          >
            {test.ok ? (
              <p>
                {t("Meta accepted the event ({n} received).", { n: test.eventsReceived })}{" "}
                {test.testEventCode
                  ? t("Open the Test events tab of the Events Manager to see it.")
                  : t("Without a test code it counts as a real PageView.")}
              </p>
            ) : (
              <>
                <p>{testErrorText(test)}</p>
                {test.message && <p className="mt-1 text-xs opacity-80">{t("What Meta said:")} {test.message}</p>}
              </>
            )}
          </div>
        )}
      </form>
    </section>
  );
}
