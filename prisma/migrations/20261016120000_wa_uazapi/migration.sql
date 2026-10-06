-- WhatsApp: segundo provedor não oficial, a uazapi (06/10/2026).
--
-- Motivo: o número pessoal do dono foi bloqueado 5 s depois de conectar pelo
-- OpenWA (whatsapp-web.js num IP de datacenter). A uazapi tem proxy gerenciado
-- por país e cidade, então a conexão sai por um IP do Brasil.
--
-- SÓ ADITIVA: nenhuma tabela ou coluna existente é apagada ou mudada de tipo.
-- Colunas novas são todas opcionais (NULL). Números que já existem continuam
-- OPENWA (e OPENWA vira o padrão da coluna provider).
-- RLS: WaSession já tem RLS forçada desde a Fase 0 (ws_member e
-- admin_read_status); as colunas novas ficam cobertas por ela. Os comandos de
-- RLS abaixo só reafirmam o padrão (são idempotentes).

DO $$
BEGIN
  IF to_regclass('whatsapp."WaSession"') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas whatsapp da Fase 0 (20261013120000_multiusuario_login_whatsapp)';
  END IF;
END $$;

-- 1. Provedor novo. (Um valor de enum novo não pode ser usado na mesma
--    transação em que foi criado, por isso nada nesta migração usa 'UAZAPI'.)
ALTER TYPE whatsapp."WaProvider" ADD VALUE IF NOT EXISTS 'UAZAPI';

-- 2. Padrão OPENWA pro que já existe e pro código antigo que não manda provider.
ALTER TABLE whatsapp."WaSession" ALTER COLUMN "provider" SET DEFAULT 'OPENWA';

-- 3. uazapi: token da instância cifrado (AES-256-GCM com ENCRYPTION_KEY, igual
--    ao webhookSecretEnc) e a região do proxy escolhida na tela.
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "instanceTokenEnc" TEXT;
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "proxyCountry" TEXT;
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "proxyState" TEXT;
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "proxyCity" TEXT;
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "proxyCityLabel" TEXT;

-- 4. RLS (padrão da Fase 0, reafirmado).
ALTER TABLE whatsapp."WaSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaSession" FORCE ROW LEVEL SECURITY;
