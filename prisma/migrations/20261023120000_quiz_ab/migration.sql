-- Teste A/B do quiz (11/10/2026).
--
-- Pedido do dono: "no quiz também, fazer a possibilidade [de teste A/B]" sem
-- quebrar o design da página. A versão B é uma tela do próprio rascunho
-- (JSON, sem tabela nova); aqui só se guarda qual versão cada visita viu.
--
-- SÓ ADITIVA: uma coluna opcional (NULL) em FunnelVisit. Nada é apagado nem
-- muda de tipo. A RLS da tabela continua a mesma.
ALTER TABLE "public"."FunnelVisit" ADD COLUMN IF NOT EXISTS "abVariant" TEXT;
