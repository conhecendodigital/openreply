import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { buildConnectFile, connectFileName, connectKeyName, isSafeKey, isSafeUrl } from "../lib/mcp/connect";
import { generateApiToken } from "../lib/api-token";

const URL_OK = "https://app.exemplo.com.br/api/mcp";

describe("arquivos de conexão do MCP", () => {
  const { token } = generateApiToken();

  it("aceita chave e URL de verdade e recusa o resto", () => {
    expect(isSafeKey(token)).toBe(true);
    expect(isSafeKey("changeme")).toBe(false);
    expect(isSafeKey(`${token}'; rm -rf ~ #`)).toBe(false);
    expect(isSafeUrl(URL_OK)).toBe(true);
    expect(isSafeUrl("https://x.com/a'; rm -rf ~ #")).toBe(false);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(() => buildConnectFile("codex", "unix", "https://x.com/'$(id)", token)).toThrow();
    expect(() => buildConnectFile("codex", "unix", URL_OK, "or_curta")).toThrow();
  });

  it("Claude Code usa o comando documentado e leva a chave só no cabeçalho", () => {
    const sh = buildConnectFile("claude-code", "unix", URL_OK, token);
    expect(sh).toContain(`claude mcp add --transport http --scope user leadengine '${URL_OK}' --header 'Authorization: Bearer ${token}'`);
    const ps = buildConnectFile("claude-code", "windows", URL_OK, token);
    expect(ps).toContain(`--header 'Authorization: Bearer ${token}'`);
  });

  it("Codex guarda a chave em variável de ambiente, nunca no config.toml", () => {
    const sh = buildConnectFile("codex", "unix", URL_OK, token);
    expect(sh).toContain('bearer_token_env_var = "LEADENGINE_API_KEY"');
    expect(sh).toContain(`url = "${URL_OK}"`);
    // a chave aparece uma vez só: no arquivo .env protegido
    expect(sh.split(token).length - 1).toBe(1);
    expect(sh).toContain("chmod 600");
    const ps = buildConnectFile("codex", "windows", URL_OK, token);
    expect(ps.split(token).length - 1).toBe(1);
    expect(ps).toContain("SetEnvironmentVariable('LEADENGINE_API_KEY'");
  });

  it("os scripts de shell têm sintaxe válida", () => {
    for (const client of ["claude-code", "codex"] as const) {
      const sh = buildConnectFile(client, "unix", URL_OK, token);
      expect(() => execFileSync("bash", ["-n"], { input: sh })).not.toThrow();
    }
  });

  it("nomes de arquivo e de chave", () => {
    expect(connectFileName("codex", "windows")).toBe("conectar-codex.ps1");
    expect(connectFileName("claude-code", "unix")).toBe("conectar-claude-code.command");
    expect(connectKeyName("claude-web", new Date("2026-10-28T12:00:00Z"))).toBe("MCP Claude.ai 2026-10-28");
  });
});
