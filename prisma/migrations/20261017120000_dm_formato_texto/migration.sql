-- Formato da DM do link (06/10/2026).
--
-- Motivo: com link, a DM ia sempre como cartão com botão (button template).
-- Em algumas versões do Instagram (web, apps antigos, pasta Solicitações) o
-- cartão não aparece: a Meta diz SENT e a pessoa não vê nada. Texto com o
-- link dentro aparece em qualquer lugar.
--
-- SÓ ADITIVA: nenhuma tabela ou coluna existente é apagada ou mudada de tipo.
-- Automation.dmFormat nasce BUTTON para TODAS as campanhas que já existem,
-- então nenhuma muda de comportamento. A tela escolhe TEXT só em campanha nova.
-- RLS: Automation é tabela do schema public sem RLS própria (o acesso é
-- sempre filtrado por workspaceId no código, igual à 20261008120000_escala,
-- que também mexeu em Automation). Nada muda nisso.

-- CreateEnum
CREATE TYPE "DmFormat" AS ENUM ('BUTTON', 'TEXT');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN "dmFormat" "DmFormat" NOT NULL DEFAULT 'BUTTON';
