"use client";

/**
 * WhatsApp > Agentes > Respostas por palavra (20/10/2026).
 * Texto fixo que sai quando chega uma frase (ex.: "Quero a aula do workshop"),
 * mesmo com os agentes desligados. Sem IA, uma vez por pessoa.
 */
import { useT } from "@/components/lang-provider";
import { btnSecondary, INPUT } from "@/components/whatsapp/ui";
import type { RespostaPalavra } from "@/lib/whatsapp/agentes/resposta-palavra";

const MAX = 20;

function novoId() {
  return `r${Math.random().toString(36).slice(2, 10)}`;
}

export function KeywordRepliesPanel({ value, onChange }: { value: RespostaPalavra[]; onChange: (v: RespostaPalavra[]) => void }) {
  const t = useT();
  const mudar = (id: string, p: Partial<RespostaPalavra>) => onChange(value.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {t("When someone sends one of these phrases, this exact text goes out by itself, even with the agents turned off. No AI, once per person. A blank line splits the text into separate messages (up to 3).")}
      </p>
      {value.length === 0 && <p className="rounded-lg border border-border px-3 py-2 text-sm text-muted">{t("No keyword reply yet.")}</p>}
      {value.map((r, i) => (
        <div key={r.id} className="panel space-y-3 rounded-xl p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">{t("Reply {n}", { n: i + 1 })}</p>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={r.ativo} onChange={(e) => mudar(r.id, { ativo: e.target.checked })} />
                {r.ativo ? t("On") : t("Off")}
              </label>
              <button type="button" className="text-sm text-error hover:underline" onClick={() => onChange(value.filter((x) => x.id !== r.id))}>
                {t("Remove")}
              </button>
            </div>
          </div>
          <label className="block text-sm">
            <span className="font-medium">{t("Phrases that trigger it")}</span>
            <input
              className={`${INPUT} mt-1`}
              value={r.palavras.join(", ")}
              placeholder={t("Quero a aula do workshop, aula do workshop")}
              onChange={(e) => mudar(r.id, { palavras: e.target.value.split(",").map((p) => p.trimStart()) })}
            />
            <span className="mt-1 block text-xs text-muted">{t("Separate with commas. Upper case and accents do not matter.")}</span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("Text that goes out")}</span>
            <textarea
              className={`${INPUT} mt-1 min-h-40`}
              value={r.texto}
              maxLength={2000}
              placeholder={t("Here is the workshop class: (link)\n\nLiked it? The Chat Sem Frescura is here: (link)")}
              onChange={(e) => mudar(r.id, { texto: e.target.value })}
            />
          </label>
        </div>
      ))}
      {value.length < MAX && (
        <button type="button" className={btnSecondary} onClick={() => onChange([...value, { id: novoId(), palavras: [], texto: "", ativo: true }])}>
          {t("Add keyword reply")}
        </button>
      )}
    </div>
  );
}
