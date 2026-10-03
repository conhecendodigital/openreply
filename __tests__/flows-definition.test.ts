/**
 * Etapa 3: formato do fluxo (zod), validação antes de publicar, variáveis,
 * payload do botão, ids de job e conversão campanha -> fluxo.
 */
import { describe, expect, it } from "vitest";
import {
  bfsOrder,
  emptyFlowDefinition,
  flowDefinitionSchema,
  flowEdges,
  parseFlowDefinition,
  type FlowDefinition,
  type FlowNode,
} from "../lib/flows/schema";
import { validateFlow, type FlowIssueCode } from "../lib/flows/validate";
import { renderFlowText } from "../lib/flows/render";
import { flowJobIds, flowPayload, parseFlowPayload } from "../lib/flows/jobs";
import { campaignToFlowDefinition, type ConvertibleCampaign } from "../lib/flows/convert";

function def(trigger: Partial<FlowDefinition["trigger"]>, nodes: FlowNode[]): FlowDefinition {
  const base = emptyFlowDefinition(trigger.type ?? "DM");
  return flowDefinitionSchema.parse({ ...base, trigger: { ...base.trigger, keywords: ["OI"], ...trigger }, nodes });
}
const msg = (id: string, text: string, extra: Partial<Extract<FlowNode, { type: "message" }>> = {}): FlowNode => ({
  id,
  type: "message",
  text,
  imageUrl: null,
  buttons: [],
  next: null,
  ...extra,
});
const codes = (d: FlowDefinition) => validateFlow(d).errors.map((e) => e.code);
const warningCodes = (d: FlowDefinition) => validateFlow(d).warnings.map((e) => e.code);

describe("flow definition schema", () => {
  it("accepts a draft with empty text (a draft saves half-written)", () => {
    const parsed = parseFlowDefinition({ trigger: { type: "DM" }, nodes: [{ id: "a", type: "message", text: "" }] });
    expect(parsed.ok).toBe(true);
  });

  it("rejects more than 50 nodes, more than 3 buttons, labels over 20 and duplicate ids", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `n${i}`, type: "end" }));
    expect(parseFlowDefinition({ trigger: { type: "DM" }, nodes: many }).ok).toBe(false);
    const buttons = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, kind: "next", label: "x", next: "z" }));
    expect(parseFlowDefinition({ trigger: { type: "DM" }, nodes: [{ id: "a", type: "message", text: "t", buttons }] }).ok).toBe(false);
    expect(
      parseFlowDefinition({
        trigger: { type: "DM" },
        nodes: [{ id: "a", type: "message", text: "t", buttons: [{ id: "b", kind: "next", label: "x".repeat(21), next: "z" }] }],
      }).ok
    ).toBe(false);
    expect(parseFlowDefinition({ trigger: { type: "DM" }, nodes: [{ id: "a", type: "end" }, { id: "a", type: "end" }] }).ok).toBe(false);
    expect(parseFlowDefinition({ trigger: { type: "DM" }, nodes: [{ id: "trigger", type: "end" }] }).ok).toBe(false);
  });

  it("rejects waits outside 1..1380 minutes and unknown node types", () => {
    expect(parseFlowDefinition({ trigger: { type: "DM" }, nodes: [{ id: "w", type: "wait", mode: "delay", minutes: 1381 }] }).ok).toBe(false);
    expect(parseFlowDefinition({ trigger: { type: "DM" }, nodes: [{ id: "w", type: "wait", mode: "delay", minutes: 0 }] }).ok).toBe(false);
    expect(parseFlowDefinition({ trigger: { type: "DM" }, nodes: [{ id: "x", type: "sms" }] }).ok).toBe(false);
  });

  it("derives the canvas edges from the nodes (one source of truth) and lists nodes in BFS order", () => {
    const d = def({ next: "a" }, [
      msg("a", "oi", { buttons: [{ id: "b1", kind: "next", label: "Quero", next: "c" }] }),
      { id: "c", type: "condition", check: { kind: "follows" }, yes: "d", no: "e" },
      msg("d", "link"),
      { id: "e", type: "end" },
    ]);
    const edges = flowEdges(d);
    expect(edges.map((e) => `${e.source}>${e.target}:${e.kind}`)).toEqual(["trigger>a:next", "a>c:button", "c>d:yes", "c>e:no"]);
    expect(edges.find((e) => e.kind === "button")?.waitsForPerson).toBe(true);
    expect(bfsOrder(d)).toEqual(["a", "c", "d", "e"]);
  });
});

describe("validation before publishing", () => {
  it("a simple DM flow is valid", () => {
    const d = def({ next: "a" }, [msg("a", "Oi {first_name}!", { next: "f" }), { id: "f", type: "end" }]);
    expect(validateFlow(d)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("needs a first step, the post and the words", () => {
    expect(codes(def({ next: null }, []))).toEqual(expect.arrayContaining(["no_nodes", "trigger_missing_next"]));
    expect(codes(def({ type: "COMMENT", next: "a", keywords: [] }, [msg("a", "oi")]))).toEqual(
      expect.arrayContaining(["trigger_missing_post", "trigger_missing_keywords"])
    );
    // Any word / any post / mention / link need no words.
    expect(codes(def({ type: "COMMENT", next: "a", keywords: [], matchAnyWord: true, matchAnyPost: true }, [msg("a", "oi")]))).toEqual([]);
    expect(codes(def({ type: "STORY_MENTION", next: "a", keywords: [] }, [msg("a", "oi")]))).toEqual([]);
    expect(codes(def({ type: "CONVERSATION_LINK", next: "a", keywords: [] }, [msg("a", "oi")]))).toEqual(["trigger_missing_link"]);
  });

  it("flags loose nodes, dangling links, empty text and buttons without destination or URL", () => {
    const d = def({ next: "a" }, [
      msg("a", "  ", {
        buttons: [
          { id: "b1", kind: "next", label: "Ir", next: null },
          { id: "b2", kind: "link", label: "Site", url: "http://inseguro.com" },
          { id: "b3", kind: "next", label: "", next: "zzz" },
        ],
      }),
      msg("solto", "ninguém chega aqui"),
    ]);
    const c = codes(d);
    for (const code of ["empty_text", "button_no_target", "button_bad_url", "button_no_label", "dangling_link", "loose_node"] as FlowIssueCode[]) {
      expect(c).toContain(code);
    }
  });

  it("a text over 640 characters is fine alone but not with buttons", () => {
    const long = "a".repeat(700);
    expect(codes(def({ next: "a" }, [msg("a", long)]))).toEqual([]);
    expect(codes(def({ next: "a" }, [msg("a", long, { buttons: [{ id: "l", kind: "link", label: "x", url: "https://x.com" }] })]))).toContain(
      "text_too_long_for_buttons"
    );
  });

  it("a loop must pass through a tap or a wait for reply", () => {
    const loop = def({ next: "a" }, [
      { id: "a", type: "action", action: { kind: "add_tag", tag: "x" }, next: "b" },
      { id: "b", type: "condition", check: { kind: "has_tag", tag: "x" }, yes: "a", no: "c" },
      { id: "c", type: "end" },
    ]);
    expect(codes(loop)).toContain("loop_without_person");
    // The follow gate loop (prompt -> tap -> check again) is fine.
    const gate = def({ next: "s" }, [
      { id: "s", type: "condition", check: { kind: "follows" }, yes: "l", no: "p" },
      msg("p", "me segue", { buttons: [{ id: "b", kind: "next", label: "Já sigo", next: "s" }] }),
      msg("l", "link"),
    ]);
    expect(codes(gate)).toEqual([]);
    const replyLoop = def({ next: "a" }, [msg("a", "responde?", { next: "w" }), { id: "w", type: "wait", mode: "reply", next: "a" }]);
    expect(codes(replyLoop)).toEqual([]);
  });

  it("waits between two moments the person acts must stay under 23 hours", () => {
    const d = def({ next: "w1" }, [
      { id: "w1", type: "wait", mode: "delay", minutes: 700, next: "a" },
      msg("a", "1", { next: "w2" }),
      { id: "w2", type: "wait", mode: "delay", minutes: 700, next: "b" },
      msg("b", "2"),
    ]);
    expect(codes(d)).toContain("waits_too_long");
    // A tap in between restarts the window.
    const ok = def({ next: "w1" }, [
      { id: "w1", type: "wait", mode: "delay", minutes: 700, next: "a" },
      msg("a", "1", { buttons: [{ id: "b", kind: "next", label: "mais", next: "w2" }] }),
      { id: "w2", type: "wait", mode: "delay", minutes: 700, next: "b" },
      msg("b", "2"),
    ]);
    expect(codes(ok)).toEqual([]);
  });

  it("comment flows: the first message is the private reply (no image) and the next one needs a tap or a reply", () => {
    const t = { type: "COMMENT" as const, matchAnyPost: true, keywords: ["FOTO"] };
    const bad = def({ ...t, next: "a" }, [msg("a", "oi", { imageUrl: "https://x.com/a.png", next: "b" }), msg("b", "link")]);
    expect(codes(bad)).toEqual(expect.arrayContaining(["private_reply_image", "closed_window_message"]));
    const good = def({ ...t, next: "a" }, [
      msg("a", "oi", { buttons: [{ id: "b1", kind: "next", label: "Quero", next: "b" }] }),
      msg("b", "link", { imageUrl: "https://x.com/a.png", next: "c" }),
      msg("c", "e mais isso"),
    ]);
    expect(codes(good)).toEqual([]);
    const viaReply = def({ ...t, next: "a" }, [msg("a", "me responde"), { id: "w", type: "wait", mode: "reply", next: "b" }, msg("b", "valeu")]);
    viaReply.nodes[0] = { ...(viaReply.nodes[0] as Extract<FlowNode, { type: "message" }>), next: "w" };
    expect(codes(viaReply)).toEqual([]);
    const warn = def({ ...t, next: "s" }, [
      { id: "s", type: "condition", check: { kind: "follows" }, yes: "a", no: "a" },
      msg("a", "oi"),
    ]);
    expect(warningCodes(warn)).toContain("follows_before_window");
  });
});

describe("variables, payloads, job ids", () => {
  it("renders {username} and {first_name} with empty fallbacks", () => {
    expect(renderFlowText("Oi {first_name}, @{username}!", { username: "@maria.s", name: "Maria Silva" })).toBe("Oi Maria, @maria.s!");
    expect(renderFlowText("Oi {first_name}, tudo bem?", { username: null, name: null })).toBe("Oi, tudo bem?");
  });

  it("flow:<runId>:<nodeId> round-trips and rejects anything else", () => {
    const payload = flowPayload("ckrun123", "n_2");
    expect(payload).toBe("flow:ckrun123:n_2");
    expect(parseFlowPayload(payload)).toEqual({ runId: "ckrun123", targetNodeId: "n_2" });
    expect(parseFlowPayload("reveal:auto_1")).toBeNull();
    expect(parseFlowPayload("flow:only")).toBeNull();
    expect(parseFlowPayload("flow:a:b:c")).toBeNull();
  });

  it("job ids are deterministic and carry no ':'", () => {
    expect(flowJobIds.start("f1", "comment:123")).toBe(flowJobIds.start("f1", "comment:123"));
    expect(flowJobIds.start("f1", "comment:123")).not.toContain(":");
    expect(flowJobIds.step("r1", 3)).toBe("flowstep_r1_3");
    expect(flowJobIds.timeout("r1", 3)).toBe("flowto_r1_3");
  });
});

function campaign(over: Partial<ConvertibleCampaign> = {}): ConvertibleCampaign {
  return {
    id: "auto_1",
    name: "FOTO",
    trigger: "COMMENT",
    postId: "media_1",
    postUrl: "https://instagram.com/p/x",
    matchAnyPost: false,
    pendingNextReel: false,
    storyId: null,
    keywords: ["FOTO"],
    matchAnyWord: false,
    wholeWordMatch: true,
    dmTriggerEnabled: false,
    dmMessage: "Aqui está teu link {username}: {link}",
    openingDmEnabled: true,
    openingDmMessage: "Oi! Toca no botão",
    openingDmButtonLabel: "Quero",
    linkButtonLabel: "Abrir",
    requireFollow: true,
    followPromptMessage: "Me segue primeiro",
    followPromptButtonLabel: "Já sigo",
    followUpEnabled: true,
    followUpMessage: "Gostou?",
    followUpDelayMinutes: 30,
    publicReplyEnabled: true,
    trackedLinks: [{ label: null, destinationUrl: "https://example.com/a" }],
    sequenceSteps: [{ order: 1, message: "Passo 1", delayMinutes: 60 }],
    ...over,
  };
}

describe("campaign -> flow", () => {
  it("copies trigger, opening DM, follow gate, link, follow-up and sequence, and the result can be published", () => {
    const { definition, warnings } = campaignToFlowDefinition(campaign());
    expect(definition.trigger).toMatchObject({ type: "COMMENT", postId: "media_1", keywords: ["FOTO"], next: "abertura" });
    const byId = Object.fromEntries(definition.nodes.map((n) => [n.id, n]));
    expect(byId.abertura).toMatchObject({ type: "message", buttons: [{ kind: "next", label: "Quero", next: "segue" }] });
    expect(byId.segue).toMatchObject({ type: "condition", check: { kind: "follows" }, yes: "link", no: "pedir_follow" });
    expect(byId.pedir_follow).toMatchObject({ buttons: [{ kind: "next", label: "Já sigo", next: "segue" }] });
    expect(byId.link).toMatchObject({
      text: "Aqui está teu link {username}:",
      buttons: [{ kind: "link", label: "Abrir", url: "https://example.com/a" }],
      next: "espera_followup",
    });
    expect(byId.espera_followup).toMatchObject({ type: "wait", mode: "delay", minutes: 30, next: "followup" });
    expect(byId.followup).toMatchObject({ text: "Gostou?", next: "espera_seq_1" });
    expect(byId.seq_1).toMatchObject({ text: "Passo 1", next: "fim" });
    expect(byId.fim).toMatchObject({ type: "end" });
    expect(warnings).toEqual(expect.arrayContaining(["public_reply_not_copied", "link_history_stays", "sequence_stop_on_reply"]));
    expect(validateFlow(flowDefinitionSchema.parse(definition)).errors).toEqual([]);
  });

  it("a DM campaign without extras becomes trigger -> link -> end, and is valid", () => {
    const { definition } = campaignToFlowDefinition(
      campaign({
        trigger: "DM",
        postId: null,
        openingDmEnabled: false,
        requireFollow: false,
        followUpEnabled: false,
        publicReplyEnabled: false,
        trackedLinks: [],
        dmMessage: "Link: https://example.com",
        sequenceSteps: [],
      })
    );
    expect(definition.nodes.map((n) => n.id)).toEqual(["link", "fim"]);
    expect(definition.trigger.postId).toBeNull();
    expect(validateFlow(definition).ok).toBe(true);
  });

  it("a comment answered straight with the link plus a follow-up is copied with a warning (window closed)", () => {
    const { definition, warnings } = campaignToFlowDefinition(
      campaign({ openingDmEnabled: false, requireFollow: false, sequenceSteps: [] })
    );
    expect(warnings).toContain("followup_needs_open_window");
    expect(validateFlow(definition).errors.map((e) => e.code)).toContain("closed_window_message");
  });

  it("flags what a flow cannot copy", () => {
    const { warnings } = campaignToFlowDefinition(
      campaign({ dmTriggerEnabled: true, pendingNextReel: true, postId: null, matchAnyPost: false })
    );
    expect(warnings).toEqual(expect.arrayContaining(["dm_trigger_not_copied", "next_reel_not_copied"]));
  });
});
