-- Desfaz prisma/migrations-wa/cerebro/migration.sql (apaga a base de
-- conhecimento, a memória dos contatos e o registro de gasto). Não remove a
-- extensão vector nem o schema whatsapp, que são de outras partes.
DROP TABLE IF EXISTS whatsapp."WaKnowledgeChunk";
DROP TABLE IF EXISTS whatsapp."WaKnowledgeDocument";
DROP TABLE IF EXISTS whatsapp."WaContactMemory";
DROP TABLE IF EXISTS whatsapp."WaAiUsage";
