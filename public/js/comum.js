// Utilitários compartilhados pelas telas.
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, opcoes = {}) {
  const init = { method: opcoes.method || 'GET', headers: {} };
  if (opcoes.body !== undefined) {
    if (opcoes.body instanceof FormData) init.body = opcoes.body;
    else { init.body = JSON.stringify(opcoes.body); init.headers['Content-Type'] = 'application/json'; }
  }
  const r = await fetch(url, init);
  if (r.status === 401 && !url.endsWith('/api/login')) {
    location.href = '/';
    throw new Error('Sessão expirada.');
  }
  const tipo = r.headers.get('content-type') || '';
  const dados = tipo.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error(dados?.erro || `Erro ${r.status}`);
  return dados;
}

function toast(msg, erro = false) {
  let box = $('#toast');
  if (!box) { box = document.createElement('div'); box.id = 'toast'; document.body.appendChild(box); }
  const d = document.createElement('div');
  d.textContent = msg;
  if (erro) d.className = 'erro';
  box.appendChild(d);
  setTimeout(() => d.remove(), erro ? 6000 : 3200);
}

/** Abre um modal com o HTML informado. Retorna { el, fechar }. */
function modal(html, { aoFechar } = {}) {
  const fundo = document.createElement('div');
  fundo.className = 'fundo-modal';
  fundo.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(fundo);
  const fechar = () => { fundo.remove(); document.removeEventListener('keydown', tecla); aoFechar?.(); };
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  document.addEventListener('keydown', tecla);
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });
  $$('[data-fechar]', fundo).forEach((b) => b.addEventListener('click', fechar));
  setTimeout(() => $('input, select, textarea', fundo)?.focus(), 30);
  return { el: fundo, fechar };
}

function confirmar(mensagem, { botao = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal(`<h2>Confirmar</h2><p>${esc(mensagem)}</p>
      <div class="rodape-modal"><button class="btn sec" data-fechar>Cancelar</button>
      <button class="btn ${perigo ? 'coral' : ''}" id="btn-conf">${esc(botao)}</button></div>`, { aoFechar: () => resolve(ok) });
    $('#btn-conf', m.el).addEventListener('click', () => { ok = true; m.fechar(); });
  });
}

// ---------- competência (mês de referência) ----------
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function competenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nomeCompetencia(c) {
  const [a, m] = c.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}
function competenciaAnterior(c) {
  const [a, m] = c.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}
function diasDoMes(c) {
  const [a, m] = c.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}
function diaDaSemana(c, dia) {
  const [a, m] = c.split('-').map(Number);
  return new Date(a, m - 1, dia).getDay();
}

/** Valor de um dia da planilha: número = quantidade; X = 1; outros códigos (F = falta…) = 0. */
function valorDia(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(',', '.');
  if (!s) return 0;
  if (s === 'X') return 1;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function lsLer(chave, padrao) { try { return localStorage.getItem(chave) ?? padrao; } catch { return padrao; } }
function lsGravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento */ } }

function dataBR(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// ---------- exportações ----------
/** Gera o PDF no servidor e abre em nova aba (ou baixa, se o navegador bloquear). */
async function abrirPdf(url, corpo, nome = 'documento.pdf') {
  const aba = window.open('', '_blank');
  try {
    const r = await fetch(url, corpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Falha ao gerar o PDF.');
    const blob = await r.blob();
    const link = URL.createObjectURL(blob);
    if (aba) aba.location.href = link;
    else baixarBlob(blob, nome);
    setTimeout(() => URL.revokeObjectURL(link), 60_000);
  } catch (e) {
    aba?.close();
    toast(e.message, true);
  }
}

function baixarBlob(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/**
 * Exporta para Excel (.xlsx) com SheetJS.
 * cabecalho: linhas de título acima da tabela; colunas: [{ titulo, largura }]; linhas: [[...]]
 */
function exportarXlsx(nomeArquivo, { aba = 'Planilha', cabecalho = [], colunas, linhas }) {
  const dados = [...cabecalho.map((l) => [l]), ...(cabecalho.length ? [[]] : []), colunas.map((c) => c.titulo), ...linhas];
  const ws = XLSX.utils.aoa_to_sheet(dados);
  ws['!cols'] = colunas.map((c) => ({ wch: c.largura || 14 }));
  const linhaCab = cabecalho.length ? cabecalho.length + 1 : 0;
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: linhaCab, c: 0 }, e: { r: linhaCab + linhas.length, c: colunas.length - 1 } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: linhaCab + 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, aba.slice(0, 31));
  XLSX.writeFile(wb, nomeArquivo);
}

/** Lê a primeira aba de um .xlsx/.csv e devolve objetos com as chaves em minúsculas sem acento. */
async function lerPlanilha(arquivo) {
  const buf = await arquivo.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
  const chave = (k) => String(k).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return linhas.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [chave(k), String(v).trim()])));
}
