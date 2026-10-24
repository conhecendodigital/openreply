/**
 * Espaços reservados para os vídeos de movimento da página inicial (24/10/2026).
 * Cada espaço mostra uma ilustração em CSS/SVG até existir o arquivo
 * public/motions/<nome>.mp4. Colocou o arquivo, o vídeo entra no lugar sozinho,
 * sem mexer em código. Sem som, em loop, até 8 s e 2 MB de preferência.
 */
export const MOTION_SLOTS = {
  hero: { aspect: "16 / 9", note: "Palco do topo: comentário vira DM e o vídeo é agendado." },
  "comentario-dm": { aspect: "4 / 3", note: "Alguém comenta uma palavra e a DM chega." },
  fluxo: { aspect: "4 / 3", note: "Blocos de um fluxo se ligando um a um." },
  publicar: { aspect: "2 / 1", note: "Vídeo escolhido, privacidade, agendado." },
} as const;

export type MotionSlotName = keyof typeof MOTION_SLOTS;
