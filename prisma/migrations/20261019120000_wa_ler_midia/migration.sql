-- WhatsApp: o agente lê áudio, foto e PDF que o cliente manda (pedido do
-- dono, 06/10/2026: "preciso que leia áudio e foto", "pdf").
--
-- Antes do agente rodar, o worker gera um texto derivado da mídia e guarda
-- na própria mensagem:
--   áudio  -> transcrição (OpenAI, chave do /admin)
--   imagem -> descrição curta (modelo com visão, mesmo provedor do agente)
--   PDF    -> trecho do texto (unpdf, sem IA)
--
-- SÓ ADITIVA: três colunas opcionais (NULL) em WaMessage. Nada é apagado nem
-- muda de tipo. RLS: WaMessage já tem RLS forçada desde a Fase 0 (as
-- políticas por workspace valem pra linha inteira, então valem pras colunas
-- novas). Retenção: o texto mora na mesma linha da mensagem e sai junto com ela.

DO $$
BEGIN
  IF to_regclass('whatsapp."WaMessage"') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas whatsapp da Fase 0 (20261013120000_multiusuario_login_whatsapp)';
  END IF;
END $$;

-- Texto derivado (transcrição, descrição ou trecho do PDF). NULL = ainda não leu ou não deu.
ALTER TABLE whatsapp."WaMessage" ADD COLUMN IF NOT EXISTS "mediaText" TEXT;
-- audio | image | pdf
ALTER TABLE whatsapp."WaMessage" ADD COLUMN IF NOT EXISTS "mediaTextKind" TEXT;
-- ok | too_large | no_key | cap | failed | no_text | unsupported (motivo quando não leu)
ALTER TABLE whatsapp."WaMessage" ADD COLUMN IF NOT EXISTS "mediaTextStatus" TEXT;
