import { manualModerationHandler } from "@/lib/moderation/manual-route";

export const dynamic = "force-dynamic";

// Unhide a comment the moderation hid (official API, hide=false).
export const POST = manualModerationHandler(false);
