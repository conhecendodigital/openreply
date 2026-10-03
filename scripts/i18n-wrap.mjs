// Codemod (2026-10-03): envolve os textos visíveis das telas em t("...") e coloca o hook de idioma.
// Uso: node scripts/i18n-wrap.mjs <arquivo.tsx>...   → reescreve os arquivos e imprime os textos (1 por linha, JSON)
// Pega: texto JSX e os atributos placeholder/title/aria-label/alt com string fixa.
// Componente cliente ("use client") ganha `const t = useT();`; servidor (async) ganha `const t = await getT();`.
import fs from "node:fs";
import ts from "typescript";

const ATTRS = new Set(["placeholder", "title", "aria-label", "alt"]);
const textos = new Set();

function util(texto) {
  const n = texto.replace(/\s+/g, " ").trim();
  if (!n || n.length < 2) return null;
  if (!/[A-Za-z]{2}/.test(n)) return null; // só número/símbolo/emoji
  if (/^[@#]|^https?:|^\/[\w/-]*$/.test(n)) return null; // @user, url, rota
  return n;
}

function lit(s) {
  return JSON.stringify(s);
}

for (const arquivo of process.argv.slice(2)) {
  const src = fs.readFileSync(arquivo, "utf8");
  const sf = ts.createSourceFile(arquivo, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const cliente = /^\s*["']use client["']/.test(src);
  const nome = /[^\w.]t\s*=>|\(\s*t\s*[,)]|\bconst t\b|\blet t\b/.test(src) ? "tr" : "t";
  const edicoes = []; // {ini, fim, novo}
  const funcoes = new Map(); // nó da função de componente → true

  function componenteDe(node) {
    // a função mais externa (de topo) que contém o nó
    let alvo = null;
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p)) alvo = p;
    }
    return alvo;
  }

  // A string literal is visible text when, walking up through only ?:, ??, ||,
  // && and parentheses, it lands in a {...} that is a JSX child or the value of
  // placeholder/title/aria-label/alt.
  function emTextoVisivel(node) {
    let p = node.parent;
    let filho = node;
    while (p && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) ||
                 (ts.isBinaryExpression(p) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind)))) {
      if (ts.isConditionalExpression(p) && filho === p.condition) return false;
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && filho === p.left) return false;
      filho = p;
      p = p.parent;
    }
    if (!p || !ts.isJsxExpression(p)) return false;
    const dono = p.parent;
    if (ts.isJsxElement(dono) || ts.isJsxFragment(dono)) return true;
    return ts.isJsxAttribute(dono) && ATTRS.has(dono.name.getText(sf));
  }

  function visitar(node) {
    if (ts.isJsxText(node)) {
      const bruto = node.getText(sf);
      const n = util(bruto);
      if (n) {
        const lead = bruto.match(/^\s*/)[0];
        const trail = bruto.match(/\s*$/)[0];
        const keepLead = lead && !lead.includes("\n") ? lead : lead.includes("\n") ? lead : "";
        edicoes.push({ ini: node.getStart(sf), fim: node.getEnd(), novo: `${keepLead}{${nome}(${lit(n)})}${trail}` });
        textos.add(n);
        const c = componenteDe(node);
        if (c) funcoes.set(c, true);
      }
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && emTextoVisivel(node)) {
      // "account" / "accounts" em {n === 1 ? "account" : "accounts"} e {x ?? "there"}
      const n = util(node.text);
      if (n) {
        edicoes.push({ ini: node.getStart(sf), fim: node.getEnd(), novo: `${nome}(${lit(n)})` });
        textos.add(n);
        const c = componenteDe(node);
        if (c) funcoes.set(c, true);
      }
    } else if (ts.isJsxAttribute(node) && ATTRS.has(node.name.getText(sf)) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const n = util(node.initializer.text);
      if (n) {
        edicoes.push({ ini: node.initializer.getStart(sf), fim: node.initializer.getEnd(), novo: `{${nome}(${lit(n)})}` });
        textos.add(n);
        const c = componenteDe(node);
        if (c) funcoes.set(c, true);
      }
    }
    ts.forEachChild(node, visitar);
  }
  visitar(sf);
  if (edicoes.length === 0) continue;

  // hook no começo de cada componente que ganhou t(...)
  for (const f of funcoes.keys()) {
    const corpo = f.body;
    if (!corpo || !ts.isBlock(corpo)) {
      console.error(`⚠️  ${arquivo}: componente sem bloco { } (arrow de expressão), coloque o hook à mão`);
      continue;
    }
    if (corpo.getText(sf).includes(`const ${nome} = useT()`) || corpo.getText(sf).includes(`const ${nome} = await getT()`)) continue;
    const async = (ts.getCombinedModifierFlags(f) & ts.ModifierFlags.Async) !== 0 || f.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
    let linha;
    if (cliente) linha = `\n  const ${nome} = useT();`;
    else if (async) linha = `\n  const ${nome} = await getT();`;
    else {
      console.error(`⚠️  ${arquivo}: componente de servidor não-async; deixei em inglês`);
      continue;
    }
    edicoes.push({ ini: corpo.getStart(sf) + 1, fim: corpo.getStart(sf) + 1, novo: linha });
  }

  edicoes.sort((a, b) => b.ini - a.ini);
  let out = src;
  for (const e of edicoes) out = out.slice(0, e.ini) + e.novo + out.slice(e.fim);

  const imp = cliente ? 'import { useT } from "@/components/lang-provider";' : 'import { getT } from "@/lib/i18n/server";';
  if (!out.includes(imp)) {
    // depois do último import do topo
    const m = [...out.matchAll(/^import[^;]+;\s*$/gm)].pop();
    out = m ? out.slice(0, m.index + m[0].length) + "\n" + imp + out.slice(m.index + m[0].length) : imp + "\n" + out;
  }
  fs.writeFileSync(arquivo, out);
  console.error(`✓ ${arquivo}: ${edicoes.length} trocas (nome ${nome})`);
}
for (const t of textos) console.log(JSON.stringify(t));
