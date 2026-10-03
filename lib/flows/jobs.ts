/**
 * Flow jobs on the same "dm-processing" queue the worker already consumes.
 * Kept out of lib/queue/client.ts on purpose (tests mock that module with a
 * fixed list of names).
 *
 * IMPORTANT: no flow job carries a "commentId" field. An older worker that
 * does not know these names treats an unknown job WITH commentId as a comment
 * (lib/queue/dm-worker.ts runJob fallback), and the campaigns would answer
 * it. The comment travels as `triggerRef` instead. Deploy the worker before
 * the web anyway.
 */
export const FLOW_START_JOB_NAME = "flow-start";
export const FLOW_STEP_JOB_NAME = "flow-step";
export const FLOW_REPLY_TIMEOUT_JOB_NAME = "flow-reply-timeout";

export const FLOW_JOB_NAMES: ReadonlySet<string> = new Set([
  FLOW_START_JOB_NAME,
  FLOW_STEP_JOB_NAME,
  FLOW_REPLY_TIMEOUT_JOB_NAME,
]);

export type FlowEventKind =
  | "COMMENT"
  | "LIVE_COMMENT"
  | "DM"
  | "STORY_REPLY"
  | "STORY_MENTION"
  | "CONVERSATION_LINK";

export interface FlowStartJob {
  /** Our account's instagramId (webhook entry.id), like every other job. */
  instagramAccountId: string;
  flowId: string;
  kind: FlowEventKind;
  /** comment:<id> | live:<id> | dm:<mid> | mention:<mid> | ref:<eventKey> */
  triggerKey: string;
  /** The comment id (COMMENT / LIVE_COMMENT) or mid. Never named commentId. */
  triggerRef: string;
  igUserId: string;
  username?: string | null;
  text?: string | null;
  /** ms. The person's DM / tap / link that opened the window (none for a comment). */
  inboundAt?: number | null;
}

export interface FlowStepJob {
  instagramAccountId: string;
  runId: string;
  /** The node the run must be at (claim). */
  nodeId: string;
  /** The run's stepCount when scheduled (claim). */
  seq: number;
  /** ms. The tap / reply that moved the run on (the CRM row may lag behind). */
  inboundAt?: number | null;
}

export interface FlowReplyTimeoutJob {
  instagramAccountId: string;
  runId: string;
  nodeId: string;
  seq: number;
}

export type FlowJob = FlowStartJob | FlowStepJob | FlowReplyTimeoutJob;

/** BullMQ job ids cannot contain ":"; base64url keeps them injective. */
function safe(value: string): string {
  return Buffer.from(value).toString("base64url");
}

export const flowJobIds = {
  start: (flowId: string, triggerKey: string) => `flowstart_${flowId}_${safe(triggerKey)}`,
  step: (runId: string, seq: number) => `flowstep_${runId}_${seq}`,
  timeout: (runId: string, seq: number) => `flowto_${runId}_${seq}`,
};

/** Button payload: flow:<runId>:<targetNodeId> (well under Meta's 1000 chars). */
export const FLOW_PAYLOAD_PREFIX = "flow:";

export function flowPayload(runId: string, targetNodeId: string): string {
  return `${FLOW_PAYLOAD_PREFIX}${runId}:${targetNodeId}`;
}

export function parseFlowPayload(payload: string): { runId: string; targetNodeId: string } | null {
  if (!payload.startsWith(FLOW_PAYLOAD_PREFIX)) return null;
  const [runId, targetNodeId, ...rest] = payload.slice(FLOW_PAYLOAD_PREFIX.length).split(":");
  if (!runId || !targetNodeId || rest.length > 0) return null;
  return { runId, targetNodeId };
}
