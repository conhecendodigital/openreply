/**
 * 27/10/2026: a Meta só aceita JPEG no carrossel. Slide PNG é convertido aqui, no servidor, na hora de
 * publicar: baixa do nosso armazenamento, converte com sharp (sem mudar o tamanho) e guarda de novo na
 * pasta do workspace (a única origem que o publicador aceita). O JPEG já enviado passa direto.
 */
import sharp from "sharp";
import { buildObjectKey, presignPut, readMediaStorageConfig } from "@/lib/media/s3";
import type { InstagramSlide } from "@/lib/social/instagram-carousel";

export const JPEG_QUALITY = 92;

/** PNG (ou outro formato de imagem) para JPEG. Transparência vira fundo branco. Não redimensiona. */
export async function convertToJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

/** Devolve o endereço de um JPEG deste slide (o próprio, se já for JPEG). */
export async function jpegUrlForSlide(workspaceId: string, slide: InstagramSlide, slideNumber: number): Promise<string> {
  if (slide.contentType === "image/jpeg") return slide.url;
  const config = readMediaStorageConfig();
  if (!config) throw new Error("Image storage is not configured on this server");
  const source = await fetch(slide.url);
  if (!source.ok) throw new Error(`Slide ${slideNumber}: could not read the image from storage (${source.status})`);
  let jpeg: Buffer;
  try {
    jpeg = await convertToJpeg(Buffer.from(await source.arrayBuffer()));
  } catch {
    throw new Error(`Slide ${slideNumber}: could not convert the image to JPEG`);
  }
  const key = buildObjectKey({ workspaceId, funnelId: "posts", ext: "jpg" });
  const signed = presignPut(config, { key, contentType: "image/jpeg", size: jpeg.length });
  const put = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(jpeg) });
  if (!put.ok) throw new Error(`Slide ${slideNumber}: could not save the JPEG copy (${put.status})`);
  return signed.publicUrl;
}
