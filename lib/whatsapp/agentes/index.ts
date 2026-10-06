/** Entrada pública do motor de agentes do WhatsApp. Ver docs/whatsapp-agentes.md. */
export { processarMensagem, aprovarRascunho, rejeitarRascunho, podeEnviar, type DepsMotor, type ResultadoMotor } from "./motor";
export { assumirConversa, devolverAoAgente, aoMensagemDoUsuario, aoMensagemDoContato, resolverModo, janelaAberta } from "./modo";
export { salvarChave, listarChaves, paraPublica } from "./credenciais";
export { aprenderTom, limparDadosPessoais } from "./tom";
export { limitesDoAmbiente } from "./teto";
export { mensagemErro } from "./provedores";
export * from "./types";
