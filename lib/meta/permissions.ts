/**
 * 27/10/2026: painel "Permissões autorizadas" do canal do Instagram. Lógica pura (tela e testes).
 *
 * A documentação da Meta consultada não traz um endpoint para LER as permissões de um token do
 * Instagram Login. O único registro documentado é o campo `permissions` da resposta da troca do
 * código pelo token (a lista concedida pela pessoa). Por isso guardamos esse campo na conexão
 * (InstagramAccount.grantedScopes) e a tela mostra "concedidas na última conexão", não uma
 * leitura ao vivo: se a pessoa tirar uma permissão depois, só uma nova conexão atualiza.
 */
import { INSTAGRAM_BASE_SCOPES, INSTAGRAM_PUBLISH_SCOPE } from "@/lib/meta/scopes";

export interface PermissionRow {
  scope: string;
  /** Texto curto em inglês; a tela passa por t(). */
  label: string;
  state: "granted" | "missing" | "unknown";
  /** Publicar é a que muda o que dá para fazer na aba Posts. */
  critical: boolean;
}

export const INSTAGRAM_SCOPE_LABELS: Record<string, string> = {
  instagram_business_basic: "Read the profile",
  instagram_business_manage_messages: "Answer Direct messages",
  instagram_business_manage_comments: "Manage comments",
  instagram_business_manage_insights: "Read insights",
  instagram_business_content_publish: "Publish Reels and carousels",
};

export interface PermissionPanel {
  rows: PermissionRow[];
  /** Nada guardado: conectou antes deste painel existir, ou a Meta não informou. */
  unknown: boolean;
  missingPublish: boolean;
  /** Pedidas e não concedidas (a pessoa desmarcou na tela da Meta). */
  missing: string[];
}

export function buildPermissionPanel(granted: readonly string[] | null | undefined, requested: readonly string[]): PermissionPanel {
  const list = granted ?? [];
  const unknown = list.length === 0;
  const all = Array.from(new Set([...requested, ...INSTAGRAM_BASE_SCOPES, INSTAGRAM_PUBLISH_SCOPE]));
  const rows: PermissionRow[] = all.map((scope) => ({
    scope,
    label: INSTAGRAM_SCOPE_LABELS[scope] ?? scope,
    state: unknown ? "unknown" : list.includes(scope) ? "granted" : "missing",
    critical: scope === INSTAGRAM_PUBLISH_SCOPE,
  }));
  return {
    rows,
    unknown,
    missingPublish: !unknown && !list.includes(INSTAGRAM_PUBLISH_SCOPE),
    missing: unknown ? [] : all.filter((s) => !list.includes(s)),
  };
}
