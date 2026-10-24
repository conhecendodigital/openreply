/** 23/10/2026: chamadas da aba Posts. Sempre { success, data } ou { success:false, error, details }. */

export interface ApiResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  code: string | null;
}

export async function callApi<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
    });
    const payload = await res.json().catch(() => null);
    if (payload?.success) return { ok: true, data: payload.data as T, error: null, code: null };
    const details = payload?.details as { code?: string } | undefined;
    return { ok: false, data: null, error: payload?.error ?? "error", code: details?.code ?? null };
  } catch {
    return { ok: false, data: null, error: "error", code: null };
  }
}

export interface UploadTicket {
  uploadUrl: string;
  publicUrl: string;
  headers: Record<string, string>;
  expiresAt: string;
}

/** PUT direto no armazenamento, com barra de progresso. */
export function putFile(
  ticket: UploadTicket,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", ticket.uploadUrl);
    const headers = { "Content-Type": contentType, ...ticket.headers };
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}
