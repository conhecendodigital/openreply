-- Botão na mensagem de depois do link da campanha (11/10/2026).
--
-- Pedido do dono: abertura "Quero o Comando" -> o Comando -> depois, a aula
-- com botão pra clicar. A mensagem de depois (follow-up) só ia em texto.
--
-- SÓ ADITIVA: uma coluna opcional (NULL) em Automation. NULL = continua
-- como antes. Automation segue sem RLS (filtro por workspaceId no código).
ALTER TABLE "public"."Automation" ADD COLUMN IF NOT EXISTS "followUpButtonLabel" TEXT;
