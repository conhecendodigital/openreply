/**
 * 23/10/2026: Página do Facebook como canal. Parsers do webhook "page" e
 * escolha do host da Graph API pelo token da Página.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUserFollowStatus,
  getUserInfo,
  hideComment,
  isFacebookPageToken,
  sendCommentReply,
  sendDirectMessage,
} from "@/lib/meta/client";
import {
  parseCommentEvents,
  parseLiveCommentEvents,
  parseMessageEvents,
  parsePostbackEvents,
} from "@/lib/meta/webhook";
import { parseDirectMessages } from "@/lib/messages/parse";

const PAGE = "1122334455";
const FB_TOKEN = "EAAtestpagetoken";
const IG_TOKEN = "IGAAtestigtoken";

function feed(value: Record<string, unknown>) {
  return { object: "page", entry: [{ id: PAGE, time: 1, changes: [{ field: "feed", value }] }] };
}

function okFetch(body: unknown = { id: "x", message_id: "m1", recipient_id: "r1", success: true }) {
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    void url;
    void init;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("token da Página", () => {
  it("EAA é Página, IG é Instagram", () => {
    expect(isFacebookPageToken(FB_TOKEN)).toBe(true);
    expect(isFacebookPageToken(IG_TOKEN)).toBe(false);
    expect(isFacebookPageToken(null)).toBe(false);
  });
});

describe("webhook object page", () => {
  it("comentário novo no post vira evento de comentário", () => {
    const events = parseCommentEvents(
      feed({
        item: "comment",
        verb: "add",
        comment_id: "post1_c1",
        post_id: `${PAGE}_post1`,
        message: "QUERO",
        from: { id: "999", name: "Maria Souza" },
      }) as never
    );
    expect(events).toEqual([
      {
        instagramAccountId: PAGE,
        commentId: "post1_c1",
        commentText: "QUERO",
        commenterId: "999",
        commenterName: "Maria Souza",
        mediaId: `${PAGE}_post1`,
      },
    ]);
  });

  it("ignora edição, curtida, comentário da própria Página e live", () => {
    expect(parseCommentEvents(feed({ item: "comment", verb: "edited", comment_id: "c", post_id: "p", from: { id: "9" } }) as never)).toEqual([]);
    expect(parseCommentEvents(feed({ item: "reaction", verb: "add", post_id: "p", from: { id: "9" } }) as never)).toEqual([]);
    expect(parseCommentEvents(feed({ item: "comment", verb: "add", comment_id: "c", post_id: "p", from: { id: PAGE } }) as never)).toEqual([]);
    expect(parseLiveCommentEvents(feed({ item: "comment", verb: "add", comment_id: "c", post_id: "p", from: { id: "9" } }) as never)).toEqual([]);
  });

  it("mensagem e botão do Messenger entram como no Instagram", () => {
    const payload = {
      object: "page",
      entry: [
        {
          id: PAGE,
          time: 1,
          messaging: [
            { sender: { id: "777" }, recipient: { id: PAGE }, timestamp: 5, message: { mid: "mid.1", text: "oi" } },
            { sender: { id: "777" }, recipient: { id: PAGE }, postback: { mid: "mid.2", payload: "LE_X", title: "Quero" } },
          ],
        },
      ],
    };
    expect(parseMessageEvents(payload as never).map((e) => [e.instagramAccountId, e.senderId, e.messageText])).toEqual([[PAGE, "777", "oi"]]);
    expect(parsePostbackEvents(payload as never).map((e) => e.payload)).toEqual(["LE_X"]);
    expect(parseDirectMessages(payload).map((m) => m.contactId)).toEqual(["777"]);
  });

  it("objeto desconhecido continua ignorado", () => {
    expect(parseMessageEvents({ object: "whatsapp_business_account", entry: [] } as never)).toEqual([]);
  });
});

describe("Graph API pelo token", () => {
  it("DM da Página vai pro graph.facebook.com/<page>/messages", async () => {
    const fetchMock = okFetch();
    await sendDirectMessage(FB_TOKEN, PAGE, "777", "oi");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(new RegExp(`^https://graph\\.facebook\\.com/v[0-9.]+/${PAGE}/messages$`));
  });

  it("DM do Instagram continua no graph.instagram.com", async () => {
    const fetchMock = okFetch();
    await sendDirectMessage(IG_TOKEN, "17841", "777", "oi");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/graph\.instagram\.com\//);
  });

  it("resposta pública na Página usa /comments; no Instagram /replies", async () => {
    let fetchMock = okFetch();
    await sendCommentReply(FB_TOKEN, "post1_c1", "te mandei no direct");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/graph\.facebook\.com\/v[0-9.]+\/post1_c1\/comments$/);
    fetchMock = okFetch();
    await sendCommentReply(IG_TOKEN, "c1", "ok");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/graph\.instagram\.com\/v[0-9.]+\/c1\/replies$/);
  });

  it("ocultar comentário na Página usa is_hidden", async () => {
    const fetchMock = okFetch();
    await hideComment(FB_TOKEN, "post1_c1", true);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.host).toBe("graph.facebook.com");
    expect(url.searchParams.get("is_hidden")).toBe("true");
    expect(url.searchParams.get("hide")).toBeNull();
  });

  it("Página não tem checagem de seguidor: devolve null sem chamar a Meta", async () => {
    const fetchMock = okFetch();
    expect(await getUserFollowStatus(FB_TOKEN, "777")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getUserInfo da Página devolve o id da Página como user_id", async () => {
    okFetch({ id: PAGE, name: "Matheus Soares", username: "omatheus.ai", picture: { data: { url: "https://x/p.jpg" } }, fan_count: 10 });
    const info = await getUserInfo(FB_TOKEN);
    expect(info).toMatchObject({ id: PAGE, user_id: PAGE, username: "omatheus.ai", name: "Matheus Soares", followers_count: 10 });
  });
});
