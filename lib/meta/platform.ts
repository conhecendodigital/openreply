/**
 * 23/10/2026: a Facebook Page is a channel too (InstagramAccount row with
 * platform FACEBOOK). Its token is a Page access token from Facebook Login,
 * which always starts with "EAA"; tokens from Instagram Login start with "IG".
 * Kept apart from lib/meta/client.ts so code that mocks the Graph client
 * (worker tests) still gets the real check.
 */
export function isFacebookPageToken(accessToken: string | null | undefined): boolean {
  return typeof accessToken === "string" && accessToken.startsWith("EAA");
}
