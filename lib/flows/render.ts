/**
 * Flow message variables: {username} (the @, without "@") and {first_name}
 * (first word of the contact's name). Unknown values render as "" (never the
 * "there" the campaigns use), and leftover double spaces are tidied.
 * Browser-safe: the Direct preview uses it too.
 */
export type FlowVars = { username?: string | null; name?: string | null };

export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function renderFlowText(text: string, vars: FlowVars): string {
  const username = (vars.username ?? "").replace(/^@/, "").trim();
  return text
    .replace(/\{username\}/gi, username)
    .replace(/\{first_name\}/gi, firstName(vars.name))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?])/g, "$1")
    .trim();
}
