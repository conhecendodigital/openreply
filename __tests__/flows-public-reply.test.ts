/**
 * Resposta pública no comentário pelos fluxos (lib/flows/public-reply.ts) e a
 * cópia dela ao abrir uma campanha como fluxo (lib/flows/convert.ts).
 */
import { describe, expect, it } from "vitest";
import { campaignPublicReplies, drawPublicReply, publicReplyPool, renderPublicReply } from "../lib/flows/public-reply";
import { campaignToFlowDefinition, type ConvertibleCampaign } from "../lib/flows/convert";
import { flowTriggerSchema } from "../lib/flows/schema";

const on = { publicReplyEnabled: true, publicReplyMessages: ["A", " B ", ""], publicReplyMessage: null };

describe("publicReplyPool", () => {
  it("the flow's own replies win over the campaign's", () => {
    expect(publicReplyPool({ type: "COMMENT", publicReplies: ["Meu"] }, on)).toEqual(["Meu"]);
  });
  it("no own replies: the source campaign's, trimmed and without empties", () => {
    expect(publicReplyPool({ type: "COMMENT", publicReplies: [" "] }, on)).toEqual(["A", "B"]);
  });
  it("campaign with only the old single text still counts", () => {
    expect(campaignPublicReplies({ publicReplyEnabled: true, publicReplyMessages: [], publicReplyMessage: "Velha" })).toEqual(["Velha"]);
  });
  it("campaign off or missing: nothing", () => {
    expect(publicReplyPool({ type: "COMMENT" }, { ...on, publicReplyEnabled: false })).toEqual([]);
    expect(publicReplyPool({ type: "COMMENT" }, null)).toEqual([]);
  });
  it("only comment triggers (never live, DM or story)", () => {
    for (const type of ["LIVE_COMMENT", "DM", "STORY_REPLY"]) {
      expect(publicReplyPool({ type, publicReplies: ["X"] }, on)).toEqual([]);
    }
  });
});

describe("draw and render", () => {
  it("draws one by the random number and never past the end", () => {
    expect(drawPublicReply(["a", "b", "c"], () => 0)).toBe("a");
    expect(drawPublicReply(["a", "b", "c"], () => 0.99)).toBe("c");
    expect(drawPublicReply(["a", "b"], () => 1)).toBe("b");
    expect(drawPublicReply([])).toBeNull();
  });
  it("fills {username}, drops {link}", () => {
    expect(renderPublicReply("Te mandei no direct @{username} {link} 📩", { username: "@ana" })).toBe("Te mandei no direct @ana 📩");
  });
});

describe("old flows keep working", () => {
  it("a trigger saved before the field existed parses with no replies", () => {
    const parsed = flowTriggerSchema.parse({ type: "COMMENT", keywords: ["OI"], next: null });
    expect(parsed.publicReplies).toEqual([]);
  });
  it("more than 10 replies or a reply over 500 characters is refused", () => {
    expect(flowTriggerSchema.safeParse({ type: "COMMENT", publicReplies: Array(11).fill("x") }).success).toBe(false);
    expect(flowTriggerSchema.safeParse({ type: "COMMENT", publicReplies: ["x".repeat(501)] }).success).toBe(false);
  });
});

describe("abrir campanha como fluxo copies the public replies", () => {
  const campaign = (over: Partial<ConvertibleCampaign> = {}): ConvertibleCampaign => ({
    id: "au_1",
    name: "GEMINI",
    trigger: "COMMENT",
    postId: "p_1",
    postUrl: null,
    matchAnyPost: false,
    pendingNextReel: false,
    storyId: null,
    keywords: ["GEMINI"],
    matchAnyWord: false,
    wholeWordMatch: true,
    dmTriggerEnabled: false,
    dmMessage: "Tá aqui",
    openingDmEnabled: false,
    openingDmMessage: null,
    openingDmButtonLabel: null,
    linkButtonLabel: null,
    requireFollow: false,
    followPromptMessage: null,
    followPromptButtonLabel: null,
    followUpEnabled: false,
    followUpMessage: null,
    followUpDelayMinutes: 60,
    publicReplyEnabled: true,
    publicReplyMessages: ["Te mandei no direct 📩", "Olha o direct!"],
    publicReplyMessage: null,
    trackedLinks: [],
    ...over,
  });

  it("copies them to the trigger and says so", () => {
    const { definition, warnings } = campaignToFlowDefinition(campaign());
    expect(definition.trigger.publicReplies).toEqual(["Te mandei no direct 📩", "Olha o direct!"]);
    expect(warnings).toContain("public_reply_copied");
    expect(warnings).not.toContain("public_reply_not_copied");
  });
  it("campaign with the public reply off: nothing copied, no warning", () => {
    const { definition, warnings } = campaignToFlowDefinition(campaign({ publicReplyEnabled: false }));
    expect(definition.trigger.publicReplies).toEqual([]);
    expect(warnings).not.toContain("public_reply_copied");
  });
  it("a story campaign never gets one", () => {
    const { definition } = campaignToFlowDefinition(campaign({ trigger: "STORY_REPLY" }));
    expect(definition.trigger.publicReplies).toEqual([]);
  });
});
