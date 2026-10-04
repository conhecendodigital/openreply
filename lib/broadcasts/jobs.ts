/**
 * Broadcast jobs on the same "dm-processing" queue. Kept out of
 * lib/queue/client.ts (tests mock that module with a fixed list of names).
 *
 * IMPORTANT: no broadcast job carries a "commentId" field, so an older
 * worker that does not know these names skips them (runJob fallback) instead
 * of treating them as a comment. Deploy the worker before the web.
 */
export const BROADCAST_START_JOB_NAME = "broadcast-start";
export const BROADCAST_BATCH_JOB_NAME = "broadcast-batch";

export const BROADCAST_JOB_NAMES: ReadonlySet<string> = new Set([
  BROADCAST_START_JOB_NAME,
  BROADCAST_BATCH_JOB_NAME,
]);

export interface BroadcastStartJob {
  /** Our account's instagramId, like every other job (noteMetaError). */
  instagramAccountId: string;
  broadcastId: string;
}

export interface BroadcastBatchJob {
  instagramAccountId: string;
  broadcastId: string;
  /** Must match Broadcast.batchSeq (claim): a duplicate finds nothing. */
  seq: number;
}

export type BroadcastJob = BroadcastStartJob | BroadcastBatchJob;

/**
 * Job ids. The batch id grows with seq: removeOnComplete keeps the last 1000
 * ids, and BullMQ ignores an add whose id it still remembers.
 */
export const broadcastJobIds = {
  start: (broadcastId: string, tag: string | number = "0") => `bcstart_${broadcastId}_${tag}`,
  batch: (broadcastId: string, seq: number, tag?: string | number) =>
    `bcbatch_${broadcastId}_${seq}${tag !== undefined ? `_${tag}` : ""}`,
};

/** Button payload: bc:<recipientId>:<buttonId> (the flow id is never in it). */
export const BROADCAST_PAYLOAD_PREFIX = "bc:";

export function broadcastPayload(recipientId: string, buttonId: string): string {
  return `${BROADCAST_PAYLOAD_PREFIX}${recipientId}:${buttonId}`;
}

export function parseBroadcastPayload(payload: string): { recipientId: string; buttonId: string } | null {
  if (!payload.startsWith(BROADCAST_PAYLOAD_PREFIX)) return null;
  const [recipientId, buttonId, ...rest] = payload.slice(BROADCAST_PAYLOAD_PREFIX.length).split(":");
  if (!recipientId || !buttonId || rest.length > 0) return null;
  return { recipientId, buttonId };
}
