/**
 * E-mail do login (link mágico). Resend por padrão, como antes; com
 * EMAIL_SERVER, o SMTP próprio de quem hospeda o Lead Engine.
 */
import nodemailer from "nodemailer";

const DEFAULT_FROM = "Lead Engine <login@example.com>";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function magicLinkEmail(url: string): { subject: string; text: string; html: string } {
  const subject = "Seu link para entrar no Lead Engine";
  const text = [
    "Oi!",
    "",
    "Clique no link abaixo para entrar no Lead Engine. Ele vale por 15 minutos e só funciona uma vez.",
    "",
    url,
    "",
    "Se não foi você que pediu, pode ignorar este e-mail. Ninguém entra sem clicar no link.",
  ].join("\n");
  const safe = escapeHtml(url);
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#fafafa;font-family:Arial,Helvetica,sans-serif;color:#262626">
<div style="max-width:420px;margin:32px auto;background:#fff;border:1px solid #dbdbdb;border-radius:12px;padding:32px 28px">
<p style="font-size:20px;font-weight:bold;margin:0 0 16px">Lead Engine</p>
<p style="font-size:15px;line-height:22px;margin:0 0 20px">Clique no botão para entrar. O link vale por 15 minutos e só funciona uma vez.</p>
<p style="margin:0 0 24px"><a href="${safe}" style="display:inline-block;background:#0095f6;color:#fff;text-decoration:none;font-weight:bold;font-size:14px;padding:10px 18px;border-radius:8px">Entrar no Lead Engine</a></p>
<p style="font-size:12px;line-height:18px;color:#737373;margin:0">Se não foi você que pediu, pode ignorar este e-mail. Ninguém entra sem clicar no link.</p>
</div></body></html>`;
  return { subject, text, html };
}

export async function sendLoginEmail(to: string, url: string): Promise<void> {
  const from = process.env.EMAIL_FROM ?? DEFAULT_FROM;
  const { subject, text, html } = magicLinkEmail(url);
  const smtp = process.env.EMAIL_SERVER;
  if (smtp) {
    await nodemailer.createTransport(smtp).sendMail({ from, to, subject, text, html });
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY (ou EMAIL_SERVER) não configurado: o link de acesso não tem como sair.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend respondeu ${res.status} ao enviar o link de acesso.`);
  }
}
