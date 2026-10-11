import { InboxView } from "@/components/whatsapp/inbox-view";

/** WhatsApp > Conversas: só conversa de uma pessoa (grupos ficam na aba Grupos). */
export default function WhatsAppInboxPage() {
  return <InboxView mode="chats" />;
}
