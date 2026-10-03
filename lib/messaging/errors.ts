import { MetaApiError } from "@/lib/meta/client";

/**
 * Meta's generic "An unknown error has occurred" (code 1) / "unexpected error"
 * (code 2): seen in production for button DMs that were actually delivered.
 * Treat as "maybe delivered": no text fallback, no retry.
 */
export function isAmbiguousDeliveryError(error: unknown): boolean {
  if (error instanceof MetaApiError && (error.code === 1 || error.code === 2)) return true;
  const message = error instanceof Error ? error.message : "";
  return /an unknown error has occurred|an unexpected error has occurred/i.test(message);
}

export function errorMessage(error: unknown): string {
  if (error instanceof MetaApiError) return `Meta API Error ${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "Unknown error";
}
