/** Para onde voltar depois do Google: a aba Posts ou a página Canais (quem pediu a conexão). */
export const YOUTUBE_RETURN_COOKIE = "yt_return";
export type YouTubeReturn = "posts" | "channels";

export function parseYouTubeReturn(value: string | null | undefined): YouTubeReturn {
  return value === "channels" ? "channels" : "posts";
}

export function youtubeReturnPath(where: YouTubeReturn): string {
  return where === "channels" ? "/channels" : "/posts";
}

/** Nome curto de um escopo para o aviso ("upload", "readonly", "force-ssl", "youtube"). */
export function shortScope(scope: string): string {
  return scope.replace("https://www.googleapis.com/auth/", "");
}
