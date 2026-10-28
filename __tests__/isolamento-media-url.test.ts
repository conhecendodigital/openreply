/** Isolamento: a URL do vídeo só vale dentro da pasta de posts do PRÓPRIO workspace (sem "..", "?", "#"). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mediaUrlProblem } from "../lib/social/common";

const BASE = "https://midia.example.com/bucket";
const KEYS = ["MEDIA_S3_ENDPOINT", "MEDIA_S3_BUCKET", "MEDIA_S3_ACCESS_KEY", "MEDIA_S3_SECRET_KEY", "MEDIA_PUBLIC_BASE_URL"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.MEDIA_S3_ENDPOINT = "https://s3.example.com";
  process.env.MEDIA_S3_BUCKET = "bucket";
  process.env.MEDIA_S3_ACCESS_KEY = "ak";
  process.env.MEDIA_S3_SECRET_KEY = "sk";
  process.env.MEDIA_PUBLIC_BASE_URL = BASE;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("mediaUrlProblem", () => {
  it("aceita arquivo da pasta do próprio workspace", () => {
    expect(mediaUrlProblem("w1", `${BASE}/w1/posts/2026-10/abc-123.mp4`)).toBeNull();
  });
  it("recusa pasta de outro workspace", () => {
    expect(mediaUrlProblem("w1", `${BASE}/w2/posts/2026-10/abc.mp4`)).not.toBeNull();
  });
  it.each([
    `${BASE}/w1/posts/../../w2/posts/x.mp4`,
    `${BASE}/w1/posts/%2e%2e/%2e%2e/w2/posts/x.mp4`,
    `${BASE}/w1/posts/..%2fw2/posts/x.mp4`,
    `${BASE}/w1/posts/a/./b.mp4`,
    `${BASE}/w1/posts/x.mp4?../../w2`,
    `${BASE}/w1/posts/x.mp4#frag`,
    `${BASE}/w1/posts/..\\..\\w2\\x.mp4`,
    `${BASE}/w1/posts/%zz.mp4`,
  ])("recusa travessia: %s", (url) => {
    expect(mediaUrlProblem("w1", url)).not.toBeNull();
  });
});
