import { facebookProvider } from "@/lib/social/providers/facebook";
import { instagramProvider } from "@/lib/social/providers/instagram";
import { tiktokProvider } from "@/lib/social/providers/tiktok";
import { youtubeProvider } from "@/lib/social/providers/youtube";
import { isSocialPlatform, type ProviderPost, type SocialPlatform, type SocialProvider } from "@/lib/social/types";

export const PROVIDERS: Record<SocialPlatform, SocialProvider> = {
  TIKTOK: tiktokProvider,
  YOUTUBE: youtubeProvider,
  INSTAGRAM: instagramProvider,
  FACEBOOK: facebookProvider,
};

export function providerFor(platform: string): SocialProvider {
  if (!isSocialPlatform(platform)) throw new Error(`Unknown network: ${platform}`);
  return PROVIDERS[platform];
}

/** Sem plataforma no post (fixtures antigas) = TikTok, que foi a primeira rede. */
export function providerForPost(post: Pick<ProviderPost, "platform" | "socialAccount" | "channel">): SocialProvider {
  const platform = post.platform ?? post.socialAccount?.platform ?? post.channel?.platform ?? "TIKTOK";
  return providerFor(platform);
}
