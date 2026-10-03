"use client";

/**
 * Flow builder (Etapa 3): /flows/new and /flows/[id].
 *
 *  - Canvas (@xyflow/react) on wide screens, a step list with inline editing
 *    on phones (both edit the same definition).
 *  - Side panel: the selected step, the checks (same validator the server
 *    runs before publishing), a Direct preview and the per-step report.
 *  - Save keeps a draft. Publish and On/Off are separate buttons; turning on
 *    asks first and shows which active campaigns win over the flow.
 *
 * A new flow is created on the first save (always off), then the URL becomes
 * /flows/<id>.
 */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/components/lang-provider";
import { Switch } from "@/components/contact-ui";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import NodePanel, { type PanelContext } from "@/components/flows/node-panel";
import DirectPreview from "@/components/flows/direct-preview";
import type { NodeBadge } from "@/components/flows/flow-canvas";
import {
  ActivateFlowDialog,
  FlowStatusChip,
  flowApi,
  flowErrorText,
  type FlowConflict,
  type FlowSummary,
} from "@/components/flows/flow-shared";
import {
  CONVERT_WARNING_LABEL,
  NODE_TONE,
  NODE_TYPE_LABEL,
  OUTCOME_LABEL,
  RUN_STATUS_LABEL,
  issueText,
  labelOr,
  nodeSummary,
  nodeTitle,
  triggerSummary,
} from "@/components/flows/flow-labels";
import {
  addNode,
  autoLayout,
  ensurePositions,
  linkOf,
  listOrder,
  removeNode,
  setLink,
  setPosition,
  type HandleId,
} from "@/components/flows/flow-model";
import {
  MAX_FLOW_NAME,
  MAX_FLOW_NODES,
  NODE_TYPES,
  TRIGGER_NODE_ID,
  bfsOrder,
  emptyFlowDefinition,
  flowDefinitionSchema,
  type FlowDefinition,
  type FlowNodeType,
} from "@/lib/flows/schema";
import { validateFlow, type FlowIssue } from "@/lib/flows/validate";

const FlowCanvas = dynamic(() => import("@/components/flows/flow-canvas"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-surface-hover" />,
});

type FlowDetail = FlowSummary & {
  draft: unknown;
  publishedDefinition: unknown;
  conflicts: FlowConflict[];
  links: { nodeId: string; buttonId: string; slug: string; destinationUrl: string }[];
};

type Report = {
  entered: number;
  completed: number;
  totals: { runs: number; byStatus: Record<string, number> };
  nodes: Record<string, { passed: number; outcomes: Record<string, number>; clicks: number; stoppedHere: Record<string, number>; waitingHere: number }>;
};

type Tab = "step" | "checks" | "preview" | "report";

const CONVERT_KEY = (id: string) => `flow-convert:${id}`;

function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(max-width: 767px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false
  );
}

function starterDefinition(): FlowDefinition {
  const base = emptyFlowDefinition("COMMENT");
  const def: FlowDefinition = {
    ...base,
    trigger: { ...base.trigger, next: "msg_1" },
    nodes: [
      { id: "msg_1", type: "message", text: "", imageUrl: null, buttons: [], next: "fim" },
      { id: "fim", type: "end" },
    ],
  };
  return autoLayout(def);
}

/** A free handle of the selected step, so "+ Message" links right after it. */
function freeHandle(def: FlowDefinition, id: string | null): HandleId | null {
  if (!id) return null;
  if (id === TRIGGER_NODE_ID) return def.trigger.next ? null : "next";
  const node = def.nodes.find((n) => n.id === id);
  if (!node) return null;
  switch (node.type) {
    case "message":
      return node.buttons.some((b) => b.kind === "next") || node.next ? null : "next";
    case "condition":
      return !node.yes ? "yes" : !node.no ? "no" : null;
    case "action":
    case "wait":
      return linkOf(def, id, "next") ? null : "next";
    case "end":
      return null;
  }
}

export default function FlowEditor({ flowId }: { flowId: string | null }) {
  const t = useT();
  const router = useRouter();
  const narrow = useNarrow();

  const [meta, setMeta] = useState<FlowDetail | null>(null);
  const [def, setDefState] = useState<FlowDefinition | null>(flowId ? null : starterDefinition);
  const [savedJson, setSavedJson] = useState("");
  const [name, setName] = useState(flowId ? "" : t("New flow"));
  const [savedName, setSavedName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(flowId ? null : TRIGGER_NODE_ID);
  const [tab, setTab] = useState<Tab>("step");
  const [viewChoice, setViewChoice] = useState<"canvas" | "list" | null>(null);
  const view = viewChoice ?? (narrow ? "list" : "canvas");

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountPick, setAccountPick] = useState("");
  const accountId = meta?.instagramAccountId ?? accountPick;

  const [tags, setTags] = useState<string[]>([]);
  const [convLinks, setConvLinks] = useState<PanelContext["conversationLinks"]>([]);
  const [stories, setStories] = useState<PanelContext["stories"]>(null);

  const [busy, setBusy] = useState<"save" | "publish" | "toggle" | "delete" | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [serverIssues, setServerIssues] = useState<FlowIssue[]>([]);
  const [convertWarnings, setConvertWarnings] = useState<string[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [activating, setActivating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // The language can change while editing; the load effect must not re-run
  // (it would throw the unsaved draft away), so it reads t through a ref.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const setDef = (update: (d: FlowDefinition) => FlowDefinition) => setDefState((d) => (d ? update(d) : d));

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    void flowApi<{ instagramAccounts: AccountOption[]; selectedInstagramAccountId?: string }>("/api/instagram/accounts").then((r) => {
      if (!alive || !r.success) return;
      const list = r.data.instagramAccounts ?? [];
      setAccounts(list);
      setAccountPick((prev) => prev || r.data.selectedInstagramAccountId || list[0]?.id || "");
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!flowId) return;
    let alive = true;
    void flowApi<FlowDetail>(`/api/flows/${encodeURIComponent(flowId)}`).then((r) => {
      if (!alive) return;
      const t = tRef.current;
      if (!r.success) {
        setLoadError(r.error === "Flow not found" ? t("Flow not found.") : flowErrorText(t, r));
        return;
      }
      const parsed = flowDefinitionSchema.safeParse(r.data.draft);
      const loaded = ensurePositions(parsed.success ? parsed.data : emptyFlowDefinition());
      if (!parsed.success) setNotice({ tone: "warn", text: t("The saved draft could not be read. It was reset to an empty flow.") });
      setMeta(r.data);
      setDefState(loaded);
      setSavedJson(JSON.stringify(loaded));
      setName(r.data.name);
      setSavedName(r.data.name);
      try {
        const raw = window.sessionStorage.getItem(CONVERT_KEY(flowId));
        if (raw) {
          setConvertWarnings(JSON.parse(raw) as string[]);
          window.sessionStorage.removeItem(CONVERT_KEY(flowId));
        }
      } catch {
        // storage blocked: the warnings are only a convenience
      }
    });
    return () => {
      alive = false;
    };
  }, [flowId]);

  // Tags of the account (conditions and actions), conversation links.
  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    const q = `instagramAccountId=${encodeURIComponent(accountId)}`;
    void flowApi<{ name: string }[]>(`/api/contacts/tags?${q}`).then((r) => {
      if (alive && r.success) setTags(r.data.map((x) => x.name));
    });
    void flowApi<{ links: PanelContext["conversationLinks"] }>(`/api/conversation-links?${q}`).then((r) => {
      if (alive && r.success) setConvLinks(r.data.links ?? []);
    });
    return () => {
      alive = false;
    };
  }, [accountId]);

  const triggerType = def?.trigger.type;
  useEffect(() => {
    if (triggerType !== "STORY_REPLY" || !accountId) return;
    let alive = true;
    void flowApi<{ id: string; thumbnail_url?: string; media_url?: string }[]>(
      `/api/instagram/stories?instagramAccountId=${encodeURIComponent(accountId)}`
    ).then((r) => {
      if (!alive) return;
      setStories(r.success ? r.data.map((s) => ({ id: s.id, thumb: s.thumbnail_url ?? s.media_url ?? null })) : []);
    });
    return () => {
      alive = false;
    };
  }, [triggerType, accountId]);

  const loadReport = (id: string) =>
    void flowApi<Report>(`/api/flows/${encodeURIComponent(id)}/report`).then((r) => {
      if (r.success) setReport(r.data);
    });

  // ── Derived ──────────────────────────────────────────────────────────────
  const defJson = useMemo(() => (def ? JSON.stringify(def) : ""), [def]);
  const dirty = !flowId || defJson !== savedJson || name.trim() !== savedName;

  const validation = useMemo(() => {
    if (!def) return { ok: false, errors: [] as FlowIssue[], warnings: [] as FlowIssue[], shape: [] as string[] };
    const parsed = flowDefinitionSchema.safeParse(def);
    if (!parsed.success) {
      return {
        ok: false,
        errors: [] as FlowIssue[],
        warnings: [] as FlowIssue[],
        shape: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      };
    }
    return { ...validateFlow(parsed.data), shape: [] as string[] };
  }, [def]);

  const allIssues = useMemo(() => [...validation.errors, ...validation.warnings], [validation]);
  const issueCount = useMemo(() => {
    const m = new Map<string, { errors: number; warnings: number }>();
    for (const e of validation.errors) {
      if (!e.nodeId) continue;
      const c = m.get(e.nodeId) ?? { errors: 0, warnings: 0 };
      c.errors++;
      m.set(e.nodeId, c);
    }
    for (const w of validation.warnings) {
      if (!w.nodeId) continue;
      const c = m.get(w.nodeId) ?? { errors: 0, warnings: 0 };
      c.warnings++;
      m.set(w.nodeId, c);
    }
    return m;
  }, [validation]);

  const badges = useMemo(() => {
    if (tab !== "report" || !report) return undefined;
    const m = new Map<string, NodeBadge[]>();
    m.set(TRIGGER_NODE_ID, [{ text: t("{n} entered", { n: report.entered }), tone: "accent" }]);
    for (const [id, s] of Object.entries(report.nodes)) {
      if (id === TRIGGER_NODE_ID) continue;
      const list: NodeBadge[] = [{ text: t("{n} passed", { n: s.passed }), tone: "accent" }];
      if (s.clicks) list.push({ text: t("{n} clicks", { n: s.clicks }), tone: "success" });
      if (s.waitingHere) list.push({ text: t("{n} waiting", { n: s.waitingHere }), tone: "warning" });
      const stopped = Object.values(s.stoppedHere).reduce((a, b) => a + b, 0);
      if (stopped) list.push({ text: t("{n} stopped", { n: stopped }), tone: "error" });
      m.set(id, list);
    }
    return m;
  }, [tab, report, t]);

  const order = useMemo(() => (def ? listOrder(def, bfsOrder(def)) : []), [def]);
  const username = meta?.account?.username ?? accounts.find((a) => a.id === accountId)?.username ?? null;
  const channelOff = meta?.account && meta.account.status !== "ACTIVE";

  // ── Guards ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dirty || !def) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, def]);

  // ── Actions ──────────────────────────────────────────────────────────────
  function select(id: string | null) {
    setSelectedId(id);
    if (id) {
      if (view === "canvas") setTab("step");
      if (narrow && view === "canvas") window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  function add(type: FlowNodeType) {
    if (!def) return;
    if (def.nodes.length >= MAX_FLOW_NODES) {
      setNotice({ tone: "error", text: t("A flow has at most {n} steps.", { n: MAX_FLOW_NODES }) });
      return;
    }
    const handle = freeHandle(def, selectedId);
    const out = addNode(def, type, handle && selectedId ? { sourceId: selectedId, handle } : null);
    setDefState(out.def);
    select(out.id);
  }

  async function save(): Promise<string | null> {
    if (!def) return null;
    const cleanName = name.trim().slice(0, MAX_FLOW_NAME) || t("New flow");
    setBusy("save");
    setNotice(null);
    if (!flowId) {
      if (!accountId) {
        setBusy(null);
        setNotice({ tone: "error", text: t("Connect an Instagram account first.") });
        return null;
      }
      const r = await flowApi<FlowDetail>("/api/flows", {
        method: "POST",
        json: { name: cleanName, instagramAccountId: accountId, draft: def },
      });
      setBusy(null);
      if (!r.success) {
        setNotice({ tone: "error", text: flowErrorText(t, r) });
        return null;
      }
      setSavedJson(defJson);
      setSavedName(cleanName);
      router.replace(`/flows/${r.data.id}`);
      return r.data.id;
    }
    const r = await flowApi<FlowDetail>(`/api/flows/${encodeURIComponent(flowId)}`, {
      method: "PATCH",
      json: { name: cleanName, draft: def },
    });
    setBusy(null);
    if (!r.success) {
      setNotice({ tone: "error", text: flowErrorText(t, r) });
      return null;
    }
    setMeta((m) => (m ? { ...m, ...r.data, conflicts: m.conflicts, links: m.links } : m));
    setSavedJson(defJson);
    setName(cleanName);
    setSavedName(cleanName);
    setNotice({ tone: "ok", text: t("Draft saved. It only runs after you publish.") });
    return flowId;
  }

  async function publish() {
    if (!def) return;
    if (!validation.ok) {
      setTab("checks");
      setNotice({ tone: "error", text: t("Fix the flow before publishing.") });
      return;
    }
    if (meta?.isActive && !window.confirm(t("The flow is on: the new version is used from the next step of each person. Publish?"))) return;
    const id = dirty ? await save() : flowId;
    if (!id) return;
    if (!flowId) return; // the page moves to /flows/<id>; publish from there
    setBusy("publish");
    const r = await flowApi<FlowDetail & { version: number; conflicts: FlowConflict[]; warnings: FlowIssue[] }>(
      `/api/flows/${encodeURIComponent(id)}/publish`,
      { method: "POST" }
    );
    setBusy(null);
    if (!r.success) {
      const errs = (r.details?.errors as FlowIssue[] | undefined) ?? [];
      setServerIssues(errs);
      if (errs.length) setTab("checks");
      setNotice({ tone: "error", text: flowErrorText(t, r) });
      return;
    }
    setServerIssues([]);
    setMeta((m) => (m ? { ...m, ...r.data, links: m.links } : m));
    setSavedJson(defJson);
    setNotice({
      tone: "ok",
      text: r.data.isActive
        ? t("Published (version {v}). The flow is on and uses it now.", { v: r.data.version })
        : t("Published (version {v}). The flow is still off: turn it on when you are ready.", { v: r.data.version }),
    });
    loadReport(id);
  }

  async function turnOff() {
    if (!flowId) return;
    setBusy("toggle");
    const r = await flowApi<FlowSummary>(`/api/flows/${encodeURIComponent(flowId)}/active`, { method: "POST", json: { isActive: false } });
    setBusy(null);
    if (!r.success) return setNotice({ tone: "error", text: flowErrorText(t, r) });
    setMeta((m) => (m ? { ...m, isActive: false } : m));
    setNotice({ tone: "ok", text: t("Flow off. People inside it stop on their next step.") });
  }

  async function remove() {
    if (!flowId || meta?.isActive) return;
    if (!window.confirm(t("Delete the flow “{name}”? Its report is deleted too.", { name: meta?.name ?? name }))) return;
    setBusy("delete");
    const r = await flowApi(`/api/flows/${encodeURIComponent(flowId)}`, { method: "DELETE" });
    setBusy(null);
    if (!r.success) return setNotice({ tone: "error", text: flowErrorText(t, r) });
    setSavedJson(defJson);
    router.push("/flows");
  }

  // Ctrl/Cmd + S saves the draft.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="panel mx-auto max-w-lg space-y-4 rounded-2xl p-8 text-center">
        <p className="text-sm text-muted">{loadError}</p>
        <Link href="/flows" className="inline-block rounded-lg bg-surface-hover px-4 py-2 text-sm font-semibold">
          {t("Back to flows")}
        </Link>
      </div>
    );
  }
  if (!def) return <div className="panel h-[60vh] animate-pulse rounded-2xl" />;

  const published = Boolean(meta?.published);
  const unpublished = published && (meta?.hasUnpublishedChanges || defJson !== savedJson);
  const errorsCount = validation.errors.length + validation.shape.length;
  const tabs: { id: Tab; label: string }[] = [
    ...(view === "canvas" ? [{ id: "step" as Tab, label: t("Step") }] : []),
    { id: "checks", label: errorsCount ? t("Checks ({n})", { n: errorsCount }) : t("Checks") },
    { id: "preview", label: t("Preview") },
    ...(flowId ? [{ id: "report" as Tab, label: t("Report") }] : []),
  ];
  const activeTab = tabs.some((x) => x.id === tab) ? tab : tabs[0].id;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Link href="/flows" className="text-sm text-muted hover:text-foreground">
            {t("← Flows")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              maxLength={MAX_FLOW_NAME}
              onChange={(e) => setName(e.target.value)}
              aria-label={t("Flow name")}
              className="min-w-0 max-w-full flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold outline-none hover:border-border focus:border-border-hover sm:max-w-md"
            />
            <FlowStatusChip isActive={Boolean(meta?.isActive)} published={published} unpublished={unpublished} />
            {published && <span className="text-xs text-muted">{t("Version {v}", { v: meta?.publishedVersion ?? 0 })}</span>}
          </div>
          {!flowId && accounts.length > 1 && (
            <AccountSelect accounts={accounts} value={accountPick} onChange={setAccountPick} includeAll={false} />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null || !dirty}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-surface-hover disabled:opacity-50"
          >
            {busy === "save" ? t("Saving…") : dirty ? t("Save draft") : t("All saved")}
          </button>
          <button
            type="button"
            onClick={() => void publish()}
            disabled={busy !== null || !flowId}
            title={!flowId ? t("Save the flow first") : undefined}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy === "publish" ? t("Publishing…") : t("Publish")}
          </button>
          {flowId && (
            <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm" title={!published ? t("Publish the flow before turning it on.") : undefined}>
              <span className="font-semibold">{meta?.isActive ? t("Switched on") : t("Switched off")}</span>
              <Switch
                checked={Boolean(meta?.isActive)}
                disabled={busy !== null || (!meta?.isActive && !published)}
                label={meta?.isActive ? t("Turn off") : t("Turn on")}
                onChange={(next) => (next ? setActivating(true) : void turnOff())}
              />
            </label>
          )}
        </div>
      </div>

      {/* Banners */}
      {notice && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl px-4 py-2.5 text-sm ${
            notice.tone === "ok" ? "bg-success/10 text-[#3a8a12]" : notice.tone === "warn" ? "bg-warning/10 text-[#8a560c]" : "bg-error/10 text-error"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-xs font-semibold opacity-70 hover:opacity-100">
            {t("Close")}
          </button>
        </div>
      )}
      {convertWarnings.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-hover px-4 py-3 text-sm">
          <p className="font-semibold">{t("Copied from the campaign. The campaign stays on and untouched; this flow is off.")}</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            {convertWarnings.map((w) => (
              <li key={w}>{labelOr(t, CONVERT_WARNING_LABEL, w)}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setConvertWarnings([])} className="text-xs font-semibold text-accent">
            {t("Got it")}
          </button>
        </div>
      )}
      {meta?.sourceAutomationId && convertWarnings.length === 0 && (
        <p className="text-xs text-muted">
          {t("Made from a campaign.")}{" "}
          <Link href={`/campaigns/${meta.sourceAutomationId}`} className="font-semibold text-accent">
            {t("Open the campaign")}
          </Link>
        </p>
      )}
      {channelOff && (
        <p className="rounded-xl bg-error/10 px-4 py-2.5 text-sm text-error">
          {t("The channel of this flow is not active: nothing is sent until it is connected again.")}
        </p>
      )}
      {meta?.isActive && unpublished && (
        <p className="rounded-xl bg-warning/10 px-4 py-2.5 text-sm text-[#8a560c]">
          {t("The flow is on with the published version. Your changes only run after Publish.")}
        </p>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Main area */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border p-0.5 text-xs font-semibold">
              {(["canvas", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setViewChoice(v)}
                  className={`rounded-md px-3 py-1 ${view === v ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
                >
                  {v === "canvas" ? t("Canvas") : t("List")}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted">{t("Add")}:</span>
            {NODE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => add(type)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-semibold hover:bg-surface-hover"
              >
                <span className={`h-2 w-2 rounded-full ${NODE_TONE[type]}`} />
                {t(NODE_TYPE_LABEL[type])}
              </button>
            ))}
            {view === "canvas" && (
              <button
                type="button"
                onClick={() => setDefState(autoLayout(def))}
                className="ml-auto rounded-full px-2.5 py-1 text-xs font-semibold text-accent hover:bg-surface-hover"
              >
                {t("Tidy up")}
              </button>
            )}
          </div>

          {view === "canvas" ? (
            <div className="panel h-[calc(100dvh-17rem)] min-h-[420px] overflow-hidden rounded-2xl">
              <FlowCanvas
                def={def}
                selectedId={selectedId}
                issueCount={issueCount}
                badges={badges}
                onSelect={select}
                onMove={(id, p) => setDef((d) => setPosition(d, id, p))}
                onLink={(source, handle, target) => setDef((d) => setLink(d, source, handle, target))}
                onDelete={(id) => {
                  setDef((d) => removeNode(d, id));
                  setSelectedId((s) => (s === id ? null : s));
                }}
              />
            </div>
          ) : (
            <ol className="space-y-2">
              {[TRIGGER_NODE_ID, ...order].map((id, index) => {
                const node = def.nodes.find((n) => n.id === id);
                const kind = id === TRIGGER_NODE_ID ? "trigger" : node?.type ?? "end";
                const open = selectedId === id;
                const counts = issueCount.get(id);
                const loose = index > 0 && validation.errors.some((e) => e.code === "loose_node" && e.nodeId === id);
                const stats = report?.nodes[id];
                return (
                  <li key={id} className={`panel overflow-hidden rounded-2xl ${open ? "ring-2 ring-accent/30" : ""}`}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(open ? null : id)}
                      aria-expanded={open}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left"
                    >
                      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${NODE_TONE[kind]}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                          {t(NODE_TYPE_LABEL[kind])}
                          {loose && ` · ${t("not connected")}`}
                        </span>
                        <span className="block truncate text-sm">
                          {id === TRIGGER_NODE_ID ? triggerSummary(t, def.trigger) : node ? nodeSummary(t, node) : id}
                        </span>
                        {stats && tab === "report" && (
                          <span className="mt-1 block text-xs text-muted">
                            {t("{n} passed", { n: stats.passed })} · {t("{n} clicks", { n: stats.clicks })} · {t("{n} waiting", { n: stats.waitingHere })}
                          </span>
                        )}
                      </span>
                      {counts?.errors ? (
                        <span className="rounded-full bg-error px-1.5 text-[11px] font-semibold text-white">{counts.errors}</span>
                      ) : counts?.warnings ? (
                        <span className="rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{counts.warnings}</span>
                      ) : null}
                    </button>
                    {open && (
                      <div className="border-t border-border px-4 py-4">
                        <NodePanel
                          def={def}
                          nodeId={id}
                          setDef={setDef}
                          ctx={{ accountId, tags, conversationLinks: convLinks, stories }}
                          issues={allIssues}
                          onSelect={setSelectedId}
                          onAdd={add}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Side panel */}
        <aside ref={panelRef} className="w-full shrink-0 space-y-3 lg:sticky lg:top-0 lg:w-[380px]">
          <div className="flex gap-4 overflow-x-auto border-b border-border">
            {tabs.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => {
                  setTab(x.id);
                  if (x.id === "report" && flowId && !report) loadReport(flowId);
                }}
                className={`shrink-0 border-b-2 pb-2 text-sm font-medium ${
                  activeTab === x.id ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"
                } ${x.id === "checks" && errorsCount ? "text-error" : ""}`}
              >
                {x.label}
              </button>
            ))}
          </div>

          <div className="panel max-h-none overflow-y-auto rounded-2xl p-4 lg:max-h-[calc(100dvh-14rem)]">
            {activeTab === "step" && (
              <NodePanel
                def={def}
                nodeId={selectedId}
                setDef={setDef}
                ctx={{ accountId, tags, conversationLinks: convLinks, stories }}
                issues={allIssues}
                onSelect={select}
                onAdd={add}
              />
            )}

            {activeTab === "checks" && (
              <ChecksPanel
                t={t}
                def={def}
                errors={validation.errors}
                warnings={validation.warnings}
                shape={validation.shape}
                serverIssues={serverIssues}
                conflicts={meta?.conflicts ?? []}
                onPick={(id) => {
                  setSelectedId(id);
                  if (view === "canvas") setTab("step");
                }}
              />
            )}

            {activeTab === "preview" && <DirectPreview def={def} username={username} onSelect={select} />}

            {activeTab === "report" && (
              <ReportPanel t={t} def={def} order={order} report={report} published={published} onRefresh={() => flowId && loadReport(flowId)} />
            )}
          </div>

          {flowId && (
            <div className="flex flex-wrap gap-3 px-1 text-xs text-muted">
              <span>{t("{n} entered", { n: meta?.stats.entered ?? 0 })}</span>
              <span>{t("{n} finished", { n: meta?.stats.completed ?? 0 })}</span>
              <span>{t("{n} inside now", { n: meta?.stats.open ?? 0 })}</span>
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy !== null || Boolean(meta?.isActive)}
                title={meta?.isActive ? t("Turn the flow off before deleting it.") : undefined}
                className="ml-auto font-semibold text-error disabled:opacity-40"
              >
                {t("Delete flow")}
              </button>
            </div>
          )}
        </aside>
      </div>

      {activating && flowId && (
        <ActivateFlowDialog
          flowId={flowId}
          flowName={meta?.name ?? name}
          onClose={() => setActivating(false)}
          onDone={(summary) => {
            setActivating(false);
            setMeta((m) => (m ? { ...m, isActive: summary.isActive, conflicts: summary.conflicts ?? m.conflicts } : m));
            setNotice({ tone: "ok", text: t("Flow on. It answers what no active campaign takes.") });
          }}
        />
      )}
    </div>
  );
}

function ChecksPanel({
  t,
  def,
  errors,
  warnings,
  shape,
  serverIssues,
  conflicts,
  onPick,
}: {
  t: ReturnType<typeof useT>;
  def: FlowDefinition;
  errors: FlowIssue[];
  warnings: FlowIssue[];
  shape: string[];
  serverIssues: FlowIssue[];
  conflicts: FlowConflict[];
  onPick: (id: string) => void;
}) {
  const row = (i: FlowIssue, n: number, tone: "error" | "warn") => (
    <li key={`${tone}-${n}`}>
      <button
        type="button"
        onClick={() => i.nodeId && onPick(i.nodeId)}
        className={`w-full rounded-lg px-3 py-2 text-left text-xs ${tone === "error" ? "bg-error/10 text-error" : "bg-warning/10 text-[#8a560c]"}`}
      >
        {i.nodeId && <span className="block font-semibold">{nodeTitle(t, def, i.nodeId)}</span>}
        {issueText(t, i)}
      </button>
    </li>
  );
  const extraServer = serverIssues.filter((s) => !errors.some((e) => e.code === s.code && e.nodeId === s.nodeId));
  return (
    <div className="space-y-4">
      {errors.length === 0 && shape.length === 0 && extraServer.length === 0 ? (
        <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-[#3a8a12]">{t("Everything checks out. The flow can be published.")}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted">{t("Fix before publishing")}</p>
          <ul className="space-y-1.5">
            {errors.map((e, n) => row(e, n, "error"))}
            {extraServer.map((e, n) => row(e, n + 1000, "error"))}
            {shape.map((s, n) => (
              <li key={`shape-${n}`} className="rounded-lg bg-error/10 px-3 py-2 font-mono text-xs text-error">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted">{t("Worth a look")}</p>
          <ul className="space-y-1.5">{warnings.map((w, n) => row(w, n, "warn"))}</ul>
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted">{t("Active campaigns on the same trigger")}</p>
        {conflicts.length === 0 ? (
          <p className="text-xs text-muted">{t("None. (Checked when the flow was opened.)")}</p>
        ) : (
          <>
            <ul className="space-y-1">
              {conflicts.map((c) => (
                <li key={c.id}>
                  <Link href={`/campaigns/${c.id}`} className="text-sm font-semibold text-accent">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">{t("A campaign always answers first. The flow only gets the events no active campaign takes.")}</p>
          </>
        )}
      </div>
    </div>
  );
}

function ReportPanel({
  t,
  def,
  order,
  report,
  published,
  onRefresh,
}: {
  t: ReturnType<typeof useT>;
  def: FlowDefinition;
  order: string[];
  report: Report | null;
  published: boolean;
  onRefresh: () => void;
}) {
  if (!published) return <p className="text-sm text-muted">{t("The report starts once the flow is published and turned on.")}</p>;
  if (!report) return <p className="text-sm text-muted">{t("Loading…")}</p>;
  const statuses = Object.entries(report.totals.byStatus).filter(([, n]) => n > 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label={t("Entered")} value={report.entered} />
        <Stat label={t("Completed")} value={report.completed} />
        <Stat label={t("Runs")} value={report.totals.runs} />
      </div>
      {statuses.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {statuses.map(([s, n]) => (
            <span key={s} className="rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-semibold">
              {labelOr(t, RUN_STATUS_LABEL, s)}: {n}
            </span>
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {order.map((id) => {
          const s = report.nodes[id];
          const node = def.nodes.find((n) => n.id === id);
          if (!node) return null;
          const stopped = Object.entries(s?.stoppedHere ?? {});
          const outcomes = Object.entries(s?.outcomes ?? {});
          return (
            <li key={id} className="rounded-xl border border-border px-3 py-2.5">
              <p className="flex items-center gap-2 text-sm">
                <span className={`h-2 w-2 shrink-0 rounded-full ${NODE_TONE[node.type]}`} />
                <span className="truncate font-semibold">{nodeSummary(t, node)}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {t("{n} passed", { n: s?.passed ?? 0 })}
                {node.type === "message" && ` · ${t("{n} clicks", { n: s?.clicks ?? 0 })}`}
                {s?.waitingHere ? ` · ${t("{n} waiting", { n: s.waitingHere })}` : ""}
              </p>
              {outcomes.length > 0 && (
                <p className="mt-1 text-[11px] text-muted">
                  {outcomes.map(([o, n]) => `${labelOr(t, OUTCOME_LABEL, o)} ${n}`).join(" · ")}
                </p>
              )}
              {stopped.length > 0 && (
                <p className="mt-1 text-[11px] text-error">
                  {t("Stopped here")}: {stopped.map(([st, n]) => `${labelOr(t, RUN_STATUS_LABEL, st)} ${n}`).join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={onRefresh} className="text-xs font-semibold text-accent">
        {t("Refresh")}
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-hover px-2 py-2">
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
