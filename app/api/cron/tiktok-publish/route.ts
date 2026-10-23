/** Nome antigo do cron (só TikTok). Hoje é o mesmo de /api/cron/social-publish; fica para quem ainda chama este endereço. */
// dynamic e maxDuration precisam ser declarados aqui: o Next não aceita reexportar a configuração da rota.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export { GET } from "@/app/api/cron/social-publish/route";
