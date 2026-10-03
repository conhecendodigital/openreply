import { manualModerationHandler } from "@/lib/moderation/manual-route";

export const dynamic = "force-dynamic";

// "Hide now" for a decision recorded in observe mode. Only acts on an existing
// moderation record, never on a free comment id.
export const POST = manualModerationHandler(true);
