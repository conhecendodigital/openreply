import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 24/10/2026: o login com Google deu "invalid_request: scopes that cannot be requested together"
// porque o Better Auth manda include_granted_scopes=true e o Google somou drive.file + YouTube.
describe("login com Google", () => {
  it("não soma permissões já liberadas ao app", () => {
    const src = readFileSync("lib/auth-config.ts", "utf8");
    expect(src).toMatch(/google:\s*\{[\s\S]*?includeGrantedScopes:\s*false/);
  });
});
