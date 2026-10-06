import { redirect } from "next/navigation";

/** /whatsapp abre direto nas conversas. */
export default function WhatsAppPage() {
  redirect("/whatsapp/inbox");
}
