// Geração de PDFs em papel timbrado (pdf-lib): timbrado em branco, documentos e tabelas.
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const FONTES = {
  regular: fs.readFileSync(path.join(__dirname, 'assets/fontes/nunito-sans-latin-400-normal.woff')),
  negrito: fs.readFileSync(path.join(__dirname, 'assets/fontes/nunito-sans-latin-700-normal.woff')),
};

// Paleta tirada do logo da Hessel Domiciliar.
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const COR = {
  teal: hex('#3f8f88'),
  tealEscuro: hex('#2b6964'),
  menta: hex('#7cc7bf'),
  mentaClara: hex('#e6f4f1'),
  coral: hex('#ef9a8a'),
  coralClaro: hex('#fdeee9'),
  texto: hex('#2d3b3a'),
  cinza: hex('#6b7b79'),
  borda: hex('#cfdedb'),
  branco: rgb(1, 1, 1),
};

const A4 = { retrato: [595.28, 841.89], paisagem: [841.89, 595.28] };
const MARGEM = 40;

/** Remove caracteres que a fonte não desenha (emojis etc.). */
function limpar(texto) {
  return String(texto ?? '')
    .replace(/[✓✔]/g, 'OK').replace(/[✗✘]/g, 'X')
    .replace(/\t/g, ' ')
    .replace(/[^\n -~ -ÿ–—‘’“”•…€]/g, '');
}

async function novoPdf(titulo) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(limpar(titulo || 'Hessel Domiciliar'));
  pdf.setProducer('Hessel Domiciliar');
  pdf.registerFontkit(fontkit);
  const f = {
    regular: await pdf.embedFont(FONTES.regular, { subset: true }),
    negrito: await pdf.embedFont(FONTES.negrito, { subset: true }),
  };
  return { pdf, f };
}

async function embutirLogo(pdf, logo) {
  if (!logo) return null;
  try {
    const ehPng = logo[0] === 0x89 && logo[1] === 0x50;
    return ehPng ? await pdf.embedPng(logo) : await pdf.embedJpg(logo);
  } catch {
    return null;
  }
}

/** Corta o texto com "…" para caber na largura. */
function caber(texto, fonte, tamanho, largura) {
  let t = limpar(texto).replace(/\n/g, ' ');
  if (fonte.widthOfTextAtSize(t, tamanho) <= largura) return t;
  while (t.length > 1 && fonte.widthOfTextAtSize(t + '…', tamanho) > largura) t = t.slice(0, -1);
  return t + '…';
}

/** Quebra o texto em linhas que caibam na largura. */
function quebrar(texto, fonte, tamanho, largura) {
  const linhas = [];
  for (const paragrafo of limpar(texto).split('\n')) {
    const palavras = paragrafo.split(/ +/);
    let atual = '';
    for (const p of palavras) {
      const teste = atual ? `${atual} ${p}` : p;
      if (fonte.widthOfTextAtSize(teste, tamanho) <= largura || !atual) atual = teste;
      else { linhas.push(atual); atual = p; }
    }
    linhas.push(atual);
  }
  return linhas;
}

/**
 * Desenha cabeçalho e rodapé do papel timbrado na página.
 * Retorna a área útil { topo, base, esquerda, direita } (coordenadas do PDF, origem embaixo).
 */
function desenharTimbrado(page, { f, logo, cfg, marcaDagua = false }) {
  const { width: W, height: H } = page.getSize();

  // Faixa superior menta com detalhe coral
  page.drawRectangle({ x: 0, y: H - 7, width: W, height: 7, color: COR.menta });
  page.drawRectangle({ x: W - 120, y: H - 7, width: 120, height: 7, color: COR.coral });

  // Logo
  const altLogo = 56;
  let xTexto = MARGEM;
  if (logo) {
    const larg = logo.width * (altLogo / logo.height);
    page.drawImage(logo, { x: MARGEM, y: H - 22 - altLogo, width: larg, height: altLogo });
    xTexto = MARGEM + larg;
  }

  // Dados da empresa, alinhados à direita
  const dir = W - MARGEM;
  const linhaDir = (texto, y, tamanho, fonte, cor) => {
    const t = caber(texto, fonte, tamanho, dir - xTexto - 10);
    if (!t) return;
    page.drawText(t, { x: dir - fonte.widthOfTextAtSize(t, tamanho), y, size: tamanho, font: fonte, color: cor });
  };
  let y = H - 38;
  linhaDir(cfg.empresa_nome || 'Hessel Domiciliar', y, 15, f.negrito, COR.tealEscuro);
  y -= 13;
  if (cfg.empresa_subtitulo) { linhaDir(cfg.empresa_subtitulo, y, 9, f.regular, COR.teal); y -= 12; }
  const contato = [cfg.empresa_cnpj && `CNPJ ${cfg.empresa_cnpj}`, cfg.empresa_telefone].filter(Boolean).join('  •  ');
  if (contato) { linhaDir(contato, y, 8, f.regular, COR.cinza); y -= 10; }
  const web = [cfg.empresa_email, cfg.empresa_site].filter(Boolean).join('  •  ');
  if (web) linhaDir(web, y, 8, f.regular, COR.cinza);

  // Linha divisória do cabeçalho
  const yLinha = H - 90;
  page.drawLine({ start: { x: MARGEM, y: yLinha }, end: { x: W - MARGEM, y: yLinha }, thickness: 0.8, color: COR.menta });
  page.drawLine({ start: { x: MARGEM, y: yLinha }, end: { x: MARGEM + 60, y: yLinha }, thickness: 2, color: COR.coral });

  // Marca d'água (logo bem clara no centro)
  if (marcaDagua && logo) {
    const larg = W * 0.42;
    const alt = logo.height * (larg / logo.width);
    page.drawImage(logo, { x: (W - larg) / 2, y: (H - alt) / 2 - 20, width: larg, height: alt, opacity: 0.06 });
  }

  // Rodapé
  const rodape = [cfg.empresa_endereco, cfg.rodape_extra].filter(Boolean);
  page.drawLine({ start: { x: MARGEM, y: 46 }, end: { x: W - MARGEM, y: 46 }, thickness: 0.6, color: COR.borda });
  let yr = 34;
  for (const r of rodape.slice(0, 2)) {
    const t = caber(r, f.regular, 7.5, W - 2 * MARGEM - 90);
    page.drawText(t, { x: (W - f.regular.widthOfTextAtSize(t, 7.5)) / 2, y: yr, size: 7.5, font: f.regular, color: COR.cinza });
    yr -= 10;
  }
  page.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: COR.menta });
  page.drawRectangle({ x: 0, y: 0, width: 120, height: 6, color: COR.coral });

  return { topo: yLinha - 22, base: 60, esquerda: MARGEM, direita: W - MARGEM };
}

function numerarPaginas(pdf, f) {
  const paginas = pdf.getPages();
  if (paginas.length < 2) return;
  paginas.forEach((p, i) => {
    const t = `Página ${i + 1} de ${paginas.length}`;
    const { width: W } = p.getSize();
    p.drawText(t, { x: W - MARGEM - f.regular.widthOfTextAtSize(t, 7.5), y: 14, size: 7.5, font: f.regular, color: COR.cinza });
  });
}

function dataHoje() {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

// ---------- 1. Papel timbrado em branco ----------
async function gerarTimbradoEmBranco({ cfg, logo, paginas = 1, orientacao = 'retrato' }) {
  const { pdf, f } = await novoPdf('Papel timbrado');
  const img = await embutirLogo(pdf, logo);
  for (let i = 0; i < Math.min(Math.max(paginas, 1), 20); i++) {
    const page = pdf.addPage(A4[orientacao] || A4.retrato);
    desenharTimbrado(page, { f, logo: img, cfg, marcaDagua: true });
  }
  return pdf.save();
}

// ---------- 2. Documento (ofício, declaração, comunicado…) ----------
async function gerarDocumento({ cfg, logo, doc }) {
  const { pdf, f } = await novoPdf(doc.titulo);
  const img = await embutirLogo(pdf, logo);
  let page, area, y;
  const novaPagina = () => {
    page = pdf.addPage(A4.retrato);
    area = desenharTimbrado(page, { f, logo: img, cfg, marcaDagua: true });
    y = area.topo;
  };
  novaPagina();
  const largura = area.direita - area.esquerda;
  const garantir = (altura) => { if (y - altura < area.base + 10) novaPagina(); };

  // Título
  if (doc.titulo) {
    for (const l of quebrar(doc.titulo.toUpperCase(), f.negrito, 14, largura)) {
      garantir(20);
      page.drawText(l, { x: (page.getWidth() - f.negrito.widthOfTextAtSize(l, 14)) / 2, y, size: 14, font: f.negrito, color: COR.tealEscuro });
      y -= 20;
    }
    y -= 12;
  }

  if (doc.destinatario) {
    for (const l of quebrar(doc.destinatario, f.regular, 11, largura)) {
      garantir(16);
      page.drawText(l, { x: area.esquerda, y, size: 11, font: f.regular, color: COR.texto });
      y -= 16;
    }
    y -= 10;
  }

  // Corpo: parágrafos separados por linha em branco
  const TAM = 11, ALT = 16.5;
  const paragrafos = String(doc.corpo || '').replace(/\r/g, '').split(/\n\s*\n/);
  for (const par of paragrafos) {
    // Cada quebra de linha manual vira um bloco; justifica todas as linhas do bloco, menos a última.
    const linhas = [];
    for (const bloco of par.trim().split('\n')) {
      const q = quebrar(bloco.trim(), f.regular, TAM, largura);
      q.forEach((l, i) => linhas.push({ l, ultima: i === q.length - 1 }));
    }
    linhas.forEach(({ l, ultima }) => {
      garantir(ALT);
      const palavras = l.split(' ');
      if (!ultima && palavras.length > 1) {
        const somaPalavras = palavras.reduce((s, p) => s + f.regular.widthOfTextAtSize(p, TAM), 0);
        const espaco = (largura - somaPalavras) / (palavras.length - 1);
        let x = area.esquerda;
        for (const p of palavras) {
          page.drawText(p, { x, y, size: TAM, font: f.regular, color: COR.texto });
          x += f.regular.widthOfTextAtSize(p, TAM) + espaco;
        }
      } else {
        page.drawText(l, { x: area.esquerda, y, size: TAM, font: f.regular, color: COR.texto });
      }
      y -= ALT;
    });
    y -= 8;
  }

  // Local e data
  const localData = doc.local_data || dataHoje();
  garantir(40);
  y -= 14;
  const ld = limpar(localData);
  page.drawText(ld, { x: area.direita - f.regular.widthOfTextAtSize(ld, TAM), y, size: TAM, font: f.regular, color: COR.texto });
  y -= 20;

  // Assinatura
  if (doc.assinatura) {
    const linhasAss = limpar(doc.assinatura).split('\n').filter(Boolean);
    garantir(60 + linhasAss.length * 14);
    y -= 40;
    const cx = page.getWidth() / 2;
    page.drawLine({ start: { x: cx - 120, y }, end: { x: cx + 120, y }, thickness: 0.7, color: COR.texto });
    y -= 14;
    linhasAss.forEach((l, i) => {
      const fonte = i === 0 ? f.negrito : f.regular;
      const t = caber(l, fonte, 10, 300);
      page.drawText(t, { x: cx - fonte.widthOfTextAtSize(t, 10) / 2, y, size: 10, font: fonte, color: COR.texto });
      y -= 13;
    });
  }

  numerarPaginas(pdf, f);
  return pdf.save();
}

// ---------- 3. Tabela (planilha de atendimento, listas, conferência…) ----------
/**
 * tabela = {
 *   titulo, subtitulo, orientacao: 'retrato'|'paisagem', tamanhoFonte,
 *   colunas: [{ titulo, largura?, alinhar?: 'esq'|'centro'|'dir', destaque? }],
 *   linhas: [[...]] ou [{ celulas: [...], negrito?: bool }],
 *   observacao?, assinaturas?: ['Nome', ...]
 * }
 */
async function gerarTabela({ cfg, logo, tabela }) {
  const { pdf, f } = await novoPdf(tabela.titulo);
  const img = await embutirLogo(pdf, logo);
  const tamanhoPagina = A4[tabela.orientacao] || A4.retrato;
  const colunas = (tabela.colunas || []).slice(0, 60);
  const linhas = (tabela.linhas || []).slice(0, 5000).map((l) => (Array.isArray(l) ? { celulas: l } : l));
  const TAM = Math.min(Math.max(Number(tabela.tamanhoFonte) || 8.5, 5.5), 12);
  const PAD = 3.5;
  const ALT_LINHA = TAM + 2 * PAD + 2;

  let page, area, y;
  const novaPagina = () => {
    page = pdf.addPage(tamanhoPagina);
    area = desenharTimbrado(page, { f, logo: img, cfg });
    y = area.topo;
  };
  novaPagina();
  const disponivel = area.direita - area.esquerda;

  // Larguras: fixas quando informadas; as demais pelo conteúdo, ajustadas para ocupar a largura útil.
  const natural = colunas.map((c, i) => {
    if (c.largura) return Number(c.largura);
    let w = f.negrito.widthOfTextAtSize(limpar(c.titulo), TAM);
    for (const l of linhas.slice(0, 400)) w = Math.max(w, f.regular.widthOfTextAtSize(limpar(l.celulas[i]), TAM));
    return Math.min(w + 2 * PAD + 2, 240);
  });
  const fixas = colunas.reduce((s, c, i) => s + (c.largura ? natural[i] : 0), 0);
  const flex = natural.reduce((s, w, i) => s + (colunas[i].largura ? 0 : w), 0);
  const sobra = disponivel - fixas;
  const larguras = natural.map((w, i) => (colunas[i].largura || flex === 0 ? w : Math.max(24, (w / flex) * sobra)));

  // Título e subtítulo
  const titulo = limpar(tabela.titulo || '');
  if (titulo) {
    page.drawText(caber(titulo, f.negrito, 13, disponivel), { x: area.esquerda, y, size: 13, font: f.negrito, color: COR.tealEscuro });
    y -= 16;
  }
  if (tabela.subtitulo) {
    for (const l of quebrar(tabela.subtitulo, f.regular, 9, disponivel).slice(0, 3)) {
      page.drawText(l, { x: area.esquerda, y, size: 9, font: f.regular, color: COR.cinza });
      y -= 12;
    }
  }
  y -= 6;

  const celula = (texto, x, w, fonte, cor, alinhar) => {
    const t = caber(texto, fonte, TAM, w - 2 * PAD);
    const tw = fonte.widthOfTextAtSize(t, TAM);
    const tx = alinhar === 'centro' ? x + (w - tw) / 2 : alinhar === 'dir' ? x + w - PAD - tw : x + PAD;
    page.drawText(t, { x: tx, y: y - PAD - TAM + 1.5, size: TAM, font: fonte, color: cor });
  };

  const cabecalho = () => {
    let x = area.esquerda;
    page.drawRectangle({ x, y: y - ALT_LINHA, width: larguras.reduce((a, b) => a + b, 0), height: ALT_LINHA, color: COR.teal });
    colunas.forEach((c, i) => {
      celula(c.titulo, x, larguras[i], f.negrito, COR.branco, c.alinhar || 'esq');
      x += larguras[i];
    });
    y -= ALT_LINHA;
  };
  cabecalho();

  linhas.forEach((linha, idx) => {
    if (y - ALT_LINHA < area.base + 4) { novaPagina(); cabecalho(); }
    let x = area.esquerda;
    const total = larguras.reduce((a, b) => a + b, 0);
    if (linha.negrito) page.drawRectangle({ x, y: y - ALT_LINHA, width: total, height: ALT_LINHA, color: COR.mentaClara });
    else if (idx % 2 === 1) page.drawRectangle({ x, y: y - ALT_LINHA, width: total, height: ALT_LINHA, color: rgb(0.975, 0.988, 0.985) });
    colunas.forEach((c, i) => {
      if (c.destaque && !linha.negrito) page.drawRectangle({ x, y: y - ALT_LINHA, width: larguras[i], height: ALT_LINHA, color: COR.coralClaro, opacity: 0.7 });
      celula(linha.celulas[i], x, larguras[i], linha.negrito ? f.negrito : f.regular, COR.texto, c.alinhar || 'esq');
      page.drawLine({ start: { x, y: y - ALT_LINHA }, end: { x, y }, thickness: 0.3, color: COR.borda });
      x += larguras[i];
    });
    page.drawLine({ start: { x, y: y - ALT_LINHA }, end: { x, y }, thickness: 0.3, color: COR.borda });
    page.drawLine({ start: { x: area.esquerda, y: y - ALT_LINHA }, end: { x, y: y - ALT_LINHA }, thickness: 0.3, color: COR.borda });
    y -= ALT_LINHA;
  });

  if (!linhas.length) {
    y -= 14;
    page.drawText('Nenhum registro.', { x: area.esquerda, y, size: 9, font: f.regular, color: COR.cinza });
  }

  if (tabela.observacao) {
    y -= 14;
    for (const l of quebrar(tabela.observacao, f.regular, 8, disponivel)) {
      if (y - 11 < area.base) novaPagina();
      page.drawText(l, { x: area.esquerda, y, size: 8, font: f.regular, color: COR.cinza });
      y -= 11;
    }
  }

  const assinaturas = (tabela.assinaturas || []).filter(Boolean).slice(0, 4);
  if (assinaturas.length) {
    if (y - 70 < area.base) novaPagina();
    y -= 50;
    const larg = Math.min(200, (disponivel - 30 * (assinaturas.length - 1)) / assinaturas.length);
    assinaturas.forEach((nome, i) => {
      const x = area.esquerda + i * (larg + 30);
      page.drawLine({ start: { x, y }, end: { x: x + larg, y }, thickness: 0.6, color: COR.texto });
      const t = caber(nome, f.regular, 8.5, larg);
      page.drawText(t, { x: x + (larg - f.regular.widthOfTextAtSize(t, 8.5)) / 2, y: y - 12, size: 8.5, font: f.regular, color: COR.texto });
    });
  }

  // Data de emissão no rodapé de cada página
  for (const p of pdf.getPages()) {
    const t = `Emitido em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    p.drawText(t, { x: MARGEM, y: 14, size: 7, font: f.regular, color: COR.cinza });
  }
  numerarPaginas(pdf, f);
  return pdf.save();
}

module.exports = { gerarTimbradoEmBranco, gerarDocumento, gerarTabela };
