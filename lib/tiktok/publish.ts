/**
 * 23/10/2026: a publicação passou para lib/social/publish.ts (serve TikTok,
 * YouTube, Instagram e Facebook). Este arquivo mantém os nomes antigos.
 */
export { getValidAccessToken } from "@/lib/tiktok/token";
export {
  checkPublishing,
  claimPost,
  runClaimedPost,
  sweepSocialPosts,
  sweepSocialPosts as sweepTikTokPosts,
  type SweepResult,
} from "@/lib/social/publish";
