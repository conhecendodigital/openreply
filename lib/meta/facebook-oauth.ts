/**
 * Facebook Login for Pages (23/10/2026). The person picks the Pages in Meta's
 * dialog; each one becomes a channel (InstagramAccount row, platform FACEBOOK)
 * with its own Page token. A Page token taken from a long-lived user token
 * does not expire, so tokenExpiresAt stays null and the refresh cron skips it.
 * Same Meta app as the webhook: FACEBOOK_APP_ID + FACEBOOK_APP_SECRET.
 */
import { getMetaGraphApiVersion, requireEnv } from "@/lib/env";

const HEX_32_BYTE = /^[a-f0-9]{64}$/i;

export const FACEBOOK_PAGE_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_manage_metadata",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
];

const FACEBOOK_OAUTH_ENV = [
  "FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "ENCRYPTION_KEY",
  "NEXTAUTH_SECRET",
] as const;

export function getMissingFacebookOAuthEnv(): string[] {
  return FACEBOOK_OAUTH_ENV.filter((name) => {
    const value = process.env[name];
    if (!value) return true;
    return name === "ENCRYPTION_KEY" && !HEX_32_BYTE.test(value);
  });
}

/** Scopes asked at connect: FACEBOOK_OAUTH_SCOPES (comma list) overrides. */
export function facebookScopes(): string[] {
  const custom = (process.env.FACEBOOK_OAUTH_SCOPES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return custom.length > 0 ? custom : FACEBOOK_PAGE_SCOPES;
}

function graph() {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

export function getFacebookAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("FACEBOOK_APP_ID"),
    redirect_uri: redirectUri,
    scope: facebookScopes().join(","),
    response_type: "code",
    state,
  });
  return `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth?${params.toString()}`;
}

async function readJson<T>(response: Response, step: string): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
  if (!response.ok || data?.error) {
    throw new Error(`${step}: ${data?.error?.message ?? `HTTP ${response.status}`} [code=${data?.error?.code ?? "-"}]`);
  }
  return data as T;
}

/** code -> short-lived user token -> long-lived user token. */
export async function exchangeFacebookCode(code: string, redirectUri: string): Promise<string> {
  const shortUrl = new URL(`${graph()}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  shortUrl.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("code", code);
  const short = await readJson<{ access_token: string }>(await fetch(shortUrl.toString()), "Code exchange");

  const longUrl = new URL(`${graph()}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", requireEnv("FACEBOOK_APP_ID"));
  longUrl.searchParams.set("client_secret", requireEnv("FACEBOOK_APP_SECRET"));
  longUrl.searchParams.set("fb_exchange_token", short.access_token);
  const long = await readJson<{ access_token: string }>(await fetch(longUrl.toString()), "Long-lived token");
  return long.access_token;
}

export type FacebookPage = {
  id: string;
  name: string;
  username?: string;
  accessToken: string;
  pictureUrl?: string;
  tasks: string[];
};

/** The person's app-scoped id (deauthorize / data deletion callbacks use it). */
export async function getFacebookUserId(userToken: string): Promise<string | null> {
  const url = new URL(`${graph()}/me`);
  url.searchParams.set("fields", "id");
  url.searchParams.set("access_token", userToken);
  const me = await readJson<{ id?: string }>(await fetch(url.toString()), "User id");
  return me.id ? String(me.id) : null;
}

/** Pages the person granted in the dialog, each with its Page token. */
export async function listFacebookPages(userToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  const first = new URL(`${graph()}/me/accounts`);
  first.searchParams.set("fields", "id,name,username,access_token,picture{url},tasks");
  first.searchParams.set("limit", "100");
  first.searchParams.set("access_token", userToken);
  let next: string | null = first.toString();
  while (next && pages.length < 200) {
    const page: {
      data?: Array<{
        id: string;
        name?: string;
        username?: string;
        access_token?: string;
        picture?: { data?: { url?: string } };
        tasks?: string[];
      }>;
      paging?: { next?: string };
    } = await readJson(await fetch(next), "Pages list");
    for (const p of page.data ?? []) {
      if (!p.id || !p.access_token) continue;
      pages.push({
        id: String(p.id),
        name: p.name ?? String(p.id),
        username: p.username,
        accessToken: p.access_token,
        pictureUrl: p.picture?.data?.url,
        tasks: p.tasks ?? [],
      });
    }
    next = page.paging?.next ?? null;
  }
  return pages;
}

/** Name shown in the app: @username when the Page has one, else its name. */
export function pageDisplayUsername(page: Pick<FacebookPage, "id" | "name" | "username">): string {
  return page.username?.trim() || page.name?.trim() || page.id;
}
