/**
 * Peças dos testes do "Treinar com um documento": zip/docx e PDF montados na
 * mão, o briefing FICTÍCIO (__tests__/fixtures/briefing-exemplo.*) e a resposta
 * que um bom modelo daria pra ele (o provedor falso devolve isso).
 * Nada aqui tem dado de cliente de verdade.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

const FIXTURES = join(__dirname, "..", "fixtures");

export function briefingTexto(): string {
  return readFileSync(join(FIXTURES, "briefing-exemplo.txt"), "utf8");
}

export function briefingDocx(): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, "briefing-exemplo.docx")));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip mínimo (sem zip64). deflate = true comprime com o método 8. */
export function buildZip(files: Record<string, string | Buffer>, options: { deflate?: boolean; encryptedFlag?: boolean } = {}): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const data = options.deflate === false ? raw : deflateRawSync(raw);
    const method = options.deflate === false ? 0 : 8;
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(raw);
    const flags = options.encryptedFlag ? 1 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

/** .docx com o corpo dado (o miolo de <w:body>). */
export function buildDocx(body: string, options: { deflate?: boolean } = {}): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return buildZip(
    {
      "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      "word/document.xml": xml,
    },
    options
  );
}

export function paragrafo(texto: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</w:t></w:r></w:p>`;
}

/** PDF simples com uma linha de texto por linha (Helvetica, só ASCII). */
export function buildPdfLines(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 11 Tf 50 760 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/**
 * O que um bom modelo devolve pro briefing fictício. É também o "JSON
 * esperado" que serve de referência pra conferir a qualidade com um documento real.
 */
export function respostaBoaDoBriefing() {
  return {
    comando_base: [
      "EMPRESA:",
      "Você atende pela Casa Firme Reformas. A empresa faz reformas e construção de casas, apartamentos e lojas. Também faz, separado, bancadas e peças de quartzo e granito.",
      "",
      "ONDE ATENDE:",
      "Cidades atendidas: Ribeirão Preto/SP e Sertãozinho/SP. O que vale é o local da obra, não onde a pessoa mora.",
      "Na Vila Exemplo, em Ribeirão Preto, casa de médio porte vai para análise da Joana. Nunca diga que a região não é atendida.",
      "Cravinhos não é atendida normalmente.",
      "Obra grande fora da região: não recuse. Passe para a Joana avaliar.",
      "Local não está claro: pergunte onde vai ser a obra.",
      "Fora da área: responda com cuidado que a disponibilidade para aquele local precisa ser analisada antes de seguir.",
      "",
      "SERVIÇOS:",
      "Aceita: reforma completa de apartamento, casa e loja; construção de casa; bancadas e peças de quartzo e granito, separado.",
      "Não aceita: reparo pequeno e isolado (ex.: trocar uma tomada, consertar um vazamento). A exceção são as bancadas de quartzo e granito.",
      "Não existe valor mínimo de serviço.",
      "",
      "HORÁRIO DE ATENDIMENTO:",
      "Segunda a sexta, das 8h às 18h. Sábados alternados: um sábado sim, outro não.",
      "",
      "PREÇO E ORÇAMENTO:",
      "Não informe preço nem faixa de preço. Quando perguntarem, entenda a necessidade e leve para a reunião.",
      "",
      "NUNCA AFIRME OU PROMETA:",
      "Preço, prazo, garantia, condição de pagamento ou visita sem confirmação.",
      "",
      "TOM DE VOZ:",
      "Informal, acolhedor e direto.",
      "",
      "QUEM ASSUME:",
      "Joana Teste recebe os contatos qualificados. Para passar para ela: WhatsApp (16) 90000-2222.",
      "",
      "SITUAÇÕES:",
      "Pede para falar com uma pessoa: passe para a Joana.",
      "Fornecedor ou candidato a emprego: passe para a Joana.",
      "Áudio ou foto sem texto: siga a conversa normalmente.",
      "Parou de responder: mande 1 lembrete depois de 24 horas. Se não responder, não insista.",
    ].join("\n"),
    fatos: [
      "Atendemos Ribeirão Preto/SP e Sertãozinho/SP",
      "Horário: segunda a sexta, das 8h às 18h, e sábados alternados",
      "Não há taxa de deslocamento",
      "Não existe valor mínimo de serviço",
      "WhatsApp da Joana: (16) 90000-2222",
    ],
    instrucoes: {
      qualificacao: [
        "PERGUNTAS (uma por vez, sem repetir o que a pessoa já disse):",
        "1. Cidade onde vai ser a obra (obrigatória).",
        "2. O que a pessoa precisa fazer ou comprar (obrigatória).",
        "3. Tipo de imóvel: casa, apartamento, loja ou outro (obrigatória quando fizer sentido).",
        "4. Se já pegou as chaves.",
        "5. Ambiente, peça ou medidas (opcional; falta de medida não é motivo de recusa).",
        "Se tiver fotos, planta ou projeto, peça o envio. Não ter não impede a reunião.",
        "OBJETIVO: levar para uma reunião online ou no escritório.",
        "RESUMO PARA A EQUIPE: nome, cidade da obra, tipo de imóvel, reforma, construção ou bancada, se já pegou as chaves, se tem projeto e fotos enviadas.",
      ].join("\n"),
      atendimento: "Quem pede para falar com uma pessoa vai para a Joana no WhatsApp (16) 90000-2222.",
      suporte: "Cliente com obra em andamento ou assunto de pós-venda não passa pela qualificação. Diga que o atendimento é pelo grupo de WhatsApp da obra.",
    },
    horario_silencio: null,
    atraso_segundos: null,
    limite_diario: null,
    mensagens_aprovadas: [
      { tipo: "boas_vindas", quando: "", texto: "Oi! Que bom falar com você 😊 Vou entender rapidinho a sua obra pra te direcionar. Em qual cidade vai ser a obra?" },
      { tipo: "encaminhamento", quando: "Quando passar para a Joana", texto: "Perfeito! Já entendi os pontos principais. Vou passar as informações pra Joana seguir com você." },
      {
        tipo: "fora_do_horario",
        quando: "",
        texto: "Oi! Recebemos sua mensagem 😊 Nosso comercial funciona de segunda a sexta, das 8h às 18h, e em sábados alternados. Pode deixar as informações por aqui que a gente segue.",
      },
      { tipo: "encerramento", quando: "", texto: "Tudo bem! Obrigada pelo contato. Quando precisar, é só chamar 😊" },
    ],
    exemplos_de_fala: [
      "Legal! Me conta onde vai ser a obra e se você já pegou as chaves 😊",
      "Entendi. Se tiver projeto ou fotos, pode mandar por aqui que a gente marca uma conversa com calma.",
    ],
    pendencias: [{ assunto: "Qual prazo de retorno a equipe consegue cumprir?", trecho: "A definir." }],
    regras_so_instrucao: [
      { regra: "Mandar 1 lembrete depois de 24 horas sem resposta", onde: "comando_base" },
      { regra: "Passar para a Joana no WhatsApp (16) 90000-2222", onde: "comando_base" },
      { regra: "Sábados alternados", onde: "comando_base" },
      { regra: "Pós-venda vai para o grupo de WhatsApp da obra", onde: "suporte" },
      { regra: "Resumo para a equipe", onde: "qualificacao" },
    ],
    contradicoes: [],
    casos_de_teste: [
      { situacao: "Apartamento em Ribeirão Preto, já com as chaves, quer reforma completa e tem projeto.", decisao: "Qualificar, pedir o projeto e levar para reunião.", motivo: "Região e serviço atendidos." },
      { situacao: "Casa em Sertãozinho, quer reforma completa.", decisao: "Qualificar e levar para reunião.", motivo: "Região e serviço atendidos." },
      { situacao: "Obra fora da região.", decisao: "Se for obra grande, passar para a Joana avaliar; se não, responder com cuidado sobre a disponibilidade.", motivo: "Exceções podem ser avaliadas." },
      { situacao: "Cliente quer só trocar uma tomada.", decisao: "Dizer com educação que a Casa Firme não faz reparo pequeno isolado.", motivo: "Serviço não atendido." },
      { situacao: "Cliente quer só uma bancada de quartzo.", decisao: "Seguir o atendimento.", motivo: "Bancadas são exceção." },
      { situacao: "Casa de médio porte na Vila Exemplo.", decisao: "Não recusar; passar para a Joana analisar.", motivo: "Precisa de avaliação." },
    ],
  };
}
