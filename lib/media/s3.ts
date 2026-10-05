/**
 * Etapa 6: own media storage (S3 compatible: SeaweedFS behind Caddy, bucket
 * with anonymous public read). Server-only. No AWS SDK: the pre-signed URL is
 * AWS Signature V4 in query string ("UNSIGNED-PAYLOAD"), done with node:crypto.
 *
 * The browser PUTs the file straight to the storage. We sign Content-Type and
 * Content-Length, so the storage refuses a different type or size than the
 * one checked here (the browser sends both by itself for a File body).
 *
 * Env (all needed, otherwise upload is off and the editor only takes links):
 *   MEDIA_S3_ENDPOINT      https://midia.example.com
 *   MEDIA_S3_BUCKET        quiz
 *   MEDIA_S3_ACCESS_KEY / MEDIA_S3_SECRET_KEY
 *   MEDIA_PUBLIC_BASE_URL  https://midia.example.com/quiz (public read of the bucket)
 *   MEDIA_S3_REGION        optional, default us-east-1
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { normalizeMediaBase } from "@/lib/funnels/media";

export const PRESIGN_EXPIRES_SECONDS = 600;

export type MediaStorageConfig = {
  endpoint: string; // origin + optional path, no trailing slash
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  publicBaseUrl: string;
};

type Env = Record<string, string | undefined>;

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_RE = /^[a-z0-9-]{1,32}$/;

/** Storage settings from the env, or null when anything is missing or wrong. */
export function readMediaStorageConfig(env: Env = process.env): MediaStorageConfig | null {
  const endpoint = normalizeMediaBase(env.MEDIA_S3_ENDPOINT);
  const bucket = env.MEDIA_S3_BUCKET?.trim() ?? "";
  const accessKey = env.MEDIA_S3_ACCESS_KEY?.trim() ?? "";
  const secretKey = env.MEDIA_S3_SECRET_KEY?.trim() ?? "";
  const publicBaseUrl = normalizeMediaBase(env.MEDIA_PUBLIC_BASE_URL);
  const region = env.MEDIA_S3_REGION?.trim() || "us-east-1";
  if (!endpoint || !publicBaseUrl || !BUCKET_RE.test(bucket) || !accessKey || !secretKey || !REGION_RE.test(region)) return null;
  return { endpoint, bucket, region, accessKey, secretKey, publicBaseUrl };
}

/** RFC 3986 encoding AWS asks for (encodeURIComponent leaves !'()* alone). */
export function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const sha256Hex = (data: string) => createHash("sha256").update(data, "utf8").digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** 20130524T000000Z */
export function amzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Generic SigV4 query-string pre-signature (S3). `path` is already the
 * canonical URI (each segment encoded). `headers` must include host; their
 * names are signed in lower case.
 */
export function presignUrl(opts: {
  method: string;
  protocol?: "https" | "http";
  host: string;
  path: string;
  region: string;
  accessKey: string;
  secretKey: string;
  date: Date;
  expiresSeconds: number;
  headers: Record<string, string>;
}): string {
  const stamp = amzDate(opts.date);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${opts.region}/s3/aws4_request`;
  const headers = Object.entries(opts.headers)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = headers.map(([k]) => k).join(";");

  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${opts.accessKey}/${scope}`],
    ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(opts.expiresSeconds)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];
  const canonicalQuery = query
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    opts.method.toUpperCase(),
    opts.path,
    canonicalQuery,
    headers.map(([k, v]) => `${k}:${v}\n`).join(""),
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${opts.secretKey}`, day);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return `${opts.protocol ?? "https"}://${opts.host}${opts.path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

const ID_PART = /^[A-Za-z0-9_-]{1,64}$/;

/** <workspaceId>/<funnelId>/<aaaa-mm>/<uuid>.<ext>. The original file name never goes in. */
export function buildObjectKey(input: { workspaceId: string; funnelId: string; ext: string; now?: Date; uuid?: string }): string {
  if (!ID_PART.test(input.workspaceId) || !ID_PART.test(input.funnelId)) throw new Error("bad id for media key");
  if (!/^[a-z0-9]{2,5}$/.test(input.ext)) throw new Error("bad extension for media key");
  const now = input.now ?? new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${input.workspaceId}/${input.funnelId}/${month}/${input.uuid ?? randomUUID()}.${input.ext}`;
}

/** Pre-signed PUT of one object (path-style: <endpoint>/<bucket>/<key>), plus its public URL. */
export function presignPut(
  config: MediaStorageConfig,
  input: { key: string; contentType: string; size: number; now?: Date; expiresSeconds?: number }
): { uploadUrl: string; publicUrl: string; headers: Record<string, string>; expiresAt: string } {
  const endpoint = new URL(config.endpoint);
  const basePath = endpoint.pathname.replace(/\/$/, "");
  const keyPath = input.key.split("/").map(awsEncode).join("/");
  const path = `${basePath}/${awsEncode(config.bucket)}/${keyPath}`;
  const now = input.now ?? new Date();
  const expires = input.expiresSeconds ?? PRESIGN_EXPIRES_SECONDS;
  const uploadUrl = presignUrl({
    method: "PUT",
    protocol: endpoint.protocol === "http:" ? "http" : "https",
    host: endpoint.host,
    path,
    region: config.region,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    date: now,
    expiresSeconds: expires,
    headers: { host: endpoint.host, "content-type": input.contentType, "content-length": String(input.size) },
  });
  return {
    uploadUrl,
    publicUrl: `${config.publicBaseUrl}/${keyPath}`,
    // Content-Length is set by the browser itself (it cannot be set by script).
    headers: { "Content-Type": input.contentType },
    expiresAt: new Date(now.getTime() + expires * 1000).toISOString(),
  };
}
