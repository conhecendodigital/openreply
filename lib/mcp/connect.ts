/**
 * Arquivos de conexão do MCP (28/10/2026). A pessoa NUNCA cola a chave no chat
 * da IA: a chave nasce na tela, vai embutida num arquivo que ela baixa e roda
 * no PC dela (ou entra no campo de cabeçalho do conector, na tela do Claude).
 * Funções puras e sem imports de servidor: a tela monta o arquivo no navegador,
 * então a chave não passa por nenhuma outra rota.
 */

export type ConnectClient = "claude-code" | "codex";
export type ConnectPlatform = "unix" | "windows";

export const MCP_SERVER_NAME = "openreply";
export const MCP_KEY_ENV = "OPENREPLY_API_KEY";

const KEY_RE = /^or_[A-Za-z0-9_-]{20,}$/;

export function isSafeKey(token: string): boolean {
  return KEY_RE.test(token);
}

/** A URL do servidor só entra no arquivo se for http(s) sem caracteres de shell. */
export function isSafeUrl(url: string): boolean {
  return /^https?:\/\/[A-Za-z0-9.\-:_/]+$/.test(url);
}

function assertSafe(url: string, token: string) {
  if (!isSafeUrl(url)) throw new Error("Invalid MCP URL");
  if (!isSafeKey(token)) throw new Error("Invalid key");
}

export function connectFileName(client: ConnectClient, platform: ConnectPlatform): string {
  const base = client === "claude-code" ? "conectar-claude-code" : "conectar-codex";
  return platform === "windows" ? `${base}.ps1` : `${base}.command`;
}

/**
 * Claude Code: `claude mcp add --transport http ... --header "Authorization: Bearer ..."`
 * (comando da documentação do Claude Code). Escopo user = vale em todas as pastas.
 */
function claudeCodeUnix(url: string, token: string): string {
  return `#!/bin/bash
# Lead Engine: conecta o Claude Code ao seu workspace.
# Este arquivo contém a sua chave. Não envie para ninguém e não cole no chat.
# Para desligar: apague a chave em Configurações > MCP no Lead Engine.
if ! command -v claude >/dev/null 2>&1; then
  echo "O Claude Code não está instalado. Instale primeiro: https://code.claude.com"
  read -r -p "Enter para fechar" _
  exit 1
fi
claude mcp remove ${MCP_SERVER_NAME} --scope user >/dev/null 2>&1
claude mcp add --transport http --scope user ${MCP_SERVER_NAME} '${url}' --header 'Authorization: Bearer ${token}' \\
  && echo "Pronto. Abra o Claude Code e digite /mcp para conferir." \\
  || echo "Não deu certo. Confira a mensagem acima."
read -r -p "Enter para fechar" _
`;
}

function claudeCodeWindows(url: string, token: string): string {
  return `# Lead Engine: conecta o Claude Code ao seu workspace.
# Este arquivo contém a sua chave. Não envie para ninguém e não cole no chat.
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "O Claude Code não está instalado. Instale primeiro: https://code.claude.com"
  Read-Host "Enter para fechar"
  exit 1
}
claude mcp remove ${MCP_SERVER_NAME} --scope user 2>$null | Out-Null
claude mcp add --transport http --scope user ${MCP_SERVER_NAME} '${url}' --header 'Authorization: Bearer ${token}'
if ($LASTEXITCODE -eq 0) { Write-Host "Pronto. Abra o Claude Code e digite /mcp para conferir." } else { Write-Host "Não deu certo. Confira a mensagem acima." }
Read-Host "Enter para fechar"
`;
}

/**
 * Codex: bloco [mcp_servers.<nome>] com url e bearer_token_env_var em
 * ~/.codex/config.toml (chaves da documentação do Codex). A chave fica numa
 * variável de ambiente, nunca dentro do config.toml.
 */
function codexUnix(url: string, token: string): string {
  return `#!/bin/bash
# Lead Engine: conecta o Codex ao seu workspace.
# Este arquivo contém a sua chave. Não envie para ninguém e não cole no chat.
mkdir -p "$HOME/.codex" "$HOME/.openreply"
ENVFILE="$HOME/.openreply/mcp.env"
umask 077
printf 'export ${MCP_KEY_ENV}=%s\\n' '${token}' > "$ENVFILE"
chmod 600 "$ENVFILE"
for RC in "$HOME/.zshrc" "$HOME/.bashrc"; do
  [ -f "$RC" ] || continue
  grep -q '.openreply/mcp.env' "$RC" || printf '\\n[ -f "$HOME/.openreply/mcp.env" ] && . "$HOME/.openreply/mcp.env"\\n' >> "$RC"
done
CFG="$HOME/.codex/config.toml"
if grep -q '^\\[mcp_servers\\.${MCP_SERVER_NAME}\\]' "$CFG" 2>/dev/null; then
  echo "O Codex já tem um servidor '${MCP_SERVER_NAME}' no config.toml. A chave nova foi salva, o bloco antigo foi mantido."
else
  printf '\\n[mcp_servers.${MCP_SERVER_NAME}]\\nurl = "${url}"\\nbearer_token_env_var = "${MCP_KEY_ENV}"\\n' >> "$CFG"
  echo "Servidor adicionado em $CFG"
fi
echo "Pronto. Feche e abra o terminal, depois abra o Codex."
read -r -p "Enter para fechar" _
`;
}

function codexWindows(url: string, token: string): string {
  return `# Lead Engine: conecta o Codex ao seu workspace.
# Este arquivo contém a sua chave. Não envie para ninguém e não cole no chat.
[Environment]::SetEnvironmentVariable('${MCP_KEY_ENV}', '${token}', 'User')
$dir = Join-Path $HOME ".codex"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$cfg = Join-Path $dir "config.toml"
if ((Test-Path $cfg) -and (Select-String -Path $cfg -Pattern '^\\[mcp_servers\\.${MCP_SERVER_NAME}\\]' -Quiet)) {
  Write-Host "O Codex já tem um servidor '${MCP_SERVER_NAME}' no config.toml. A chave nova foi salva, o bloco antigo foi mantido."
} else {
  Add-Content -Path $cfg -Value "\`n[mcp_servers.${MCP_SERVER_NAME}]\`nurl = \`"${url}\`"\`nbearer_token_env_var = \`"${MCP_KEY_ENV}\`"\`n"
  Write-Host "Servidor adicionado em $cfg"
}
Write-Host "Pronto. Feche e abra o terminal, depois abra o Codex."
Read-Host "Enter para fechar"
`;
}

/** Conteúdo do arquivo de conexão, com a chave embutida. Lança erro se URL ou chave forem estranhas. */
export function buildConnectFile(
  client: ConnectClient,
  platform: ConnectPlatform,
  url: string,
  token: string
): string {
  assertSafe(url, token);
  if (client === "claude-code") {
    return platform === "windows" ? claudeCodeWindows(url, token) : claudeCodeUnix(url, token);
  }
  return platform === "windows" ? codexWindows(url, token) : codexUnix(url, token);
}

/** Nome da chave criada pelo botão, para aparecer na lista e ser revogada depois. */
export function connectKeyName(client: ConnectClient | "claude-web", date = new Date()): string {
  const label = client === "claude-code" ? "Claude Code" : client === "codex" ? "Codex" : "Claude.ai";
  return `MCP ${label} ${date.toISOString().slice(0, 10)}`;
}
