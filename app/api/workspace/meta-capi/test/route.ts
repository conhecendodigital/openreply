import { NextRequest } from "next/server";
import { capiJson, requireCapiManager } from "@/lib/meta/capi-settings";
import { getCapiSettings, isCapiReady, newEventId, sendCapiEvent } from "@/lib/meta/capi";
import { getBaseUrl } from "@/lib/env";
import { getRequestIp } from "@/lib/tracking/server";

export const dynamic = "force-dynamic";

// "Send a test event": one PageView to the account Pixel with the saved token
// (and the test_event_code, when there is one). Answers what Meta said:
// events_received, or an error code the screen shows in Portuguese.
export async function POST(request: NextRequest) {
  const gate = await requireCapiManager();
  if ("error" in gate) return gate.error;
  const settings = await getCapiSettings(gate.context.workspaceId);
  if (!isCapiReady(settings)) {
    return capiJson({ success: true, data: { ok: false, code: "not_configured", testEventCode: false } });
  }
  const result = await sendCapiEvent(
    settings,
    {
      eventName: "PageView",
      eventId: newEventId("test"),
      eventSourceUrl: getBaseUrl(),
      user: {
        ip: getRequestIp(request),
        userAgent: request.headers.get("user-agent") || "Lead Engine test",
        externalId: `test-${gate.context.workspaceId}`,
      },
    },
    { workspaceId: gate.context.workspaceId, log: false }
  );
  return capiJson({ success: true, data: { ...result, testEventCode: Boolean(settings?.testEventCode) } });
}
