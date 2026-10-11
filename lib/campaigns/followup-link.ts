/**
 * Botão na mensagem de depois do link (11/10/2026). Pedido do dono: abertura
 * "Quero o Comando" → o Comando → depois de uns minutos, a aula com botão.
 *
 * Com `followUpButtonLabel` preenchido (e a mensagem de depois ligada):
 * - com 2 links, o 2º sai do cartão principal e vai como botão na mensagem
 *   de depois (ex.: 1º = "Ver o Comando", 2º = "Quero minha vaga");
 * - com 1 link, ele fica no cartão e a mensagem de depois repete o mesmo link
 *   (lembrete);
 * - quem já clicou nesse link não recebe a mensagem de depois.
 * Sem o rótulo, tudo continua como antes (mensagem de depois só em texto).
 */

export function hasFollowUpButton(a: {
  followUpEnabled?: boolean | null;
  followUpMessage?: string | null;
  followUpButtonLabel?: string | null;
}): boolean {
  return Boolean(a.followUpEnabled && a.followUpMessage?.trim() && a.followUpButtonLabel?.trim());
}

export function splitFollowUpLinks<T>(links: readonly T[], followUpButton: boolean): { main: T[]; followUp: T | null } {
  if (!followUpButton || links.length === 0) return { main: links.slice(), followUp: null };
  if (links.length === 1) return { main: links.slice(), followUp: links[0] };
  return { main: [links[0], ...links.slice(2)], followUp: links[1] };
}
