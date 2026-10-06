// Hessel Domiciliar · fechamento de folhas e produtividade
// Servidor HTTP: login, cadastros, planilha de atendimento, conferência de folhas,
// documentos em papel timbrado e área de administração.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { db, DATA_DIR, DB_FILE, lerConfig, hashSenha, conferirSenha } = require('./db');
const { gerarTimbradoEmBranco, gerarDocumento, gerarTabela } = require('./pdf');

const PORT = Number(process.env.PORT) || 3000;
const PRODUCAO = process.env.NODE_ENV === 'production';

const SECRET_FILE = path.join(DATA_DIR, '.session-secret');
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
  return fs.readFileSync(SECRET_FILE, 'utf8');
})();

// Primeiro acesso: cria o administrador inicial se ainda não houver usuários.
if (!db.prepare('SELECT COUNT(*) n FROM usuarios').get().n) {
  const login = process.env.ADMIN_LOGIN || 'admin';
  const senha = process.env.ADMIN_PASSWORD || (PRODUCAO ? null : 'hessel-admin');
  if (!senha) {
    console.error('[erro] Em produção defina ADMIN_PASSWORD para criar o primeiro administrador.');
    process.exit(1);
  }
  db.prepare("INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?, ?, ?, 'admin')")
    .run('Administrador', login, hashSenha(senha));
  console.log(`[info] Administrador inicial criado: login "${login}"${process.env.ADMIN_PASSWORD ? '' : ' / senha "hessel-admin" (troque no primeiro acesso)'}.`);
}

// ---------- utilitários ----------
function assinar(payload) {
  const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}

function verificar(token) {
  if (!token) return null;
  const [corpo, sig] = token.split('.');
  if (!corpo || !sig) return null;
  const esperado = crypto.createHmac('sha256', SESSION_SECRET).update(corpo).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const payload = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function lerCookies(req) {
  const out = {};
  for (const parte of (req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0) out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

const HORAS_SESSAO = 12;
function definirSessao(res, usuario) {
  const token = assinar({ uid: usuario.id, v: usuario.senha_hash.slice(-12), exp: Date.now() + HORAS_SESSAO * 3600e3 });
  res.cookie('sess_hessel', token, { httpOnly: true, sameSite: 'lax', maxAge: HORAS_SESSAO * 3600e3, secure: PRODUCAO });
}

function exigirLogin(req, res, next) {
  const s = verificar(lerCookies(req).sess_hessel);
  const u = s && db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(s.uid);
  // A sessão cai quando a senha é trocada (v = final do hash).
  if (!u || u.senha_hash.slice(-12) !== s.v) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  req.usuario = u;
  next();
}

function exigirAdmin(req, res, next) {
  exigirLogin(req, res, () => {
    if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
    next();
  });
}

function auditar(req, acao, detalhe = '') {
  db.prepare('INSERT INTO auditoria (usuario, acao, detalhe, ip) VALUES (?, ?, ?, ?)')
    .run(req.usuario?.login || '-', acao, String(detalhe).slice(0, 500), req.ip || '');
}

const texto = (v, max = 300) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const textoLongo = (v, max = 4000) => {
  const t = String(v ?? '').replace(/\r/g, '').trim();
  return t ? t.slice(0, max) : null;
};
const competenciaValida = (c) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(c || ''));
const diasNoMes = (c) => { const [a, m] = c.split('-').map(Number); return new Date(a, m, 0).getDate(); };

function arquivoLogo() {
  for (const ext of ['png', 'jpg']) {
    const p = path.join(DATA_DIR, `logo.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return path.join(__dirname, 'public/img/logo.png');
}
const lerLogo = () => fs.readFileSync(arquivoLogo());

function enviarPdf(res, bytes, nome) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(nome)}`);
  res.end(Buffer.from(bytes));
}

// Async handlers: erros viram 500 com mensagem genérica.
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/logo', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(arquivoLogo()); });

// ---------- autenticação ----------
const falhas = new Map(); // ip -> { n, ate }
app.post('/api/login', (req, res) => {
  const ip = req.ip || '';
  const f = falhas.get(ip);
  if (f && f.n >= 8 && f.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });

  const login = texto(req.body?.login, 80);
  const u = login && db.prepare('SELECT * FROM usuarios WHERE login = ?').get(login);
  if (!u || !u.ativo || !conferirSenha(req.body?.senha || '', u.senha_hash)) {
    const atual = f && f.ate > Date.now() ? f : { n: 0 };
    falhas.set(ip, { n: atual.n + 1, ate: Date.now() + 10 * 60e3 });
    return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
  }
  falhas.delete(ip);
  db.prepare("UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE id = ?").run(u.id);
  definirSessao(res, u);
  req.usuario = u;
  auditar(req, 'login');
  res.json({ ok: true, perfil: u.perfil });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('sess_hessel');
  res.json({ ok: true });
});

app.get('/api/eu', exigirLogin, (req, res) => {
  const { id, nome, login, perfil } = req.usuario;
  res.json({ id, nome, login, perfil, padrao: perfil === 'admin' && conferirSenha('hessel-admin', req.usuario.senha_hash) });
});

app.post('/api/eu/senha', exigirLogin, (req, res) => {
  const { atual, nova } = req.body || {};
  if (!conferirSenha(atual || '', req.usuario.senha_hash)) return res.status(400).json({ erro: 'Senha atual incorreta.' });
  if (String(nova || '').length < 8) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  const hash = hashSenha(nova);
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hash, req.usuario.id);
  definirSessao(res, { ...req.usuario, senha_hash: hash });
  auditar(req, 'trocou a própria senha');
  res.json({ ok: true });
});

app.get('/api/config', exigirLogin, (req, res) => res.json(lerConfig()));

// ---------- cadastros (pacientes e profissionais) ----------
const CADASTROS = {
  pacientes: {
    rotulo: 'paciente',
    campos: ['nome', 'cpf', 'nascimento', 'telefone', 'responsavel', 'endereco', 'convenio', 'observacoes'],
    fk: 'paciente_id',
  },
  profissionais: {
    rotulo: 'profissional',
    campos: ['nome', 'cpf', 'categoria', 'registro', 'telefone', 'email', 'chave_pix', 'observacoes'],
    fk: 'profissional_id',
  },
};

const chaveNome = (nome) => String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

for (const [tabela, def] of Object.entries(CADASTROS)) {
  const limparItem = (b) => {
    const item = {};
    for (const c of def.campos) item[c] = c === 'observacoes' || c === 'endereco' ? textoLongo(b?.[c], 1000) : texto(b?.[c], 200);
    return item;
  };
  const duplicado = (nome, ignorarId = 0) =>
    db.prepare(`SELECT id, nome FROM ${tabela} WHERE id <> ?`).all(ignorarId).find((r) => chaveNome(r.nome) === chaveNome(nome));

  app.get(`/api/${tabela}`, exigirLogin, (req, res) => {
    res.json(db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM atendimentos x WHERE x.${def.fk} = t.id) AS usos FROM ${tabela} t ORDER BY t.ativo DESC, t.nome COLLATE NOCASE`).all());
  });

  app.post(`/api/${tabela}`, exigirLogin, (req, res) => {
    const item = limparItem(req.body);
    if (!item.nome) return res.status(400).json({ erro: 'Informe o nome.' });
    const dup = duplicado(item.nome);
    if (dup) return res.status(409).json({ erro: `Já existe ${def.rotulo} com esse nome: ${dup.nome}.` });
    const cols = def.campos.join(', ');
    const r = db.prepare(`INSERT INTO ${tabela} (${cols}) VALUES (${def.campos.map(() => '?').join(', ')})`).run(...def.campos.map((c) => item[c]));
    auditar(req, `cadastrou ${def.rotulo}`, item.nome);
    res.json({ id: Number(r.lastInsertRowid) });
  });

  app.put(`/api/${tabela}/:id`, exigirLogin, (req, res) => {
    const id = Number(req.params.id);
    const atual = db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(id);
    if (!atual) return res.status(404).json({ erro: 'Registro não encontrado.' });
    const item = limparItem({ ...atual, ...req.body });
    if (!item.nome) return res.status(400).json({ erro: 'Informe o nome.' });
    const dup = duplicado(item.nome, id);
    if (dup) return res.status(409).json({ erro: `Já existe ${def.rotulo} com esse nome: ${dup.nome}.` });
    const ativo = req.body?.ativo === undefined ? atual.ativo : (req.body.ativo ? 1 : 0);
    db.prepare(`UPDATE ${tabela} SET ${def.campos.map((c) => `${c} = ?`).join(', ')}, ativo = ?, atualizado_em = datetime('now') WHERE id = ?`)
      .run(...def.campos.map((c) => item[c]), ativo, id);
    auditar(req, `alterou ${def.rotulo}`, item.nome + (ativo !== atual.ativo ? (ativo ? ' (reativado)' : ' (inativado)') : ''));
    res.json({ ok: true });
  });

  app.delete(`/api/${tabela}/:id`, exigirLogin, (req, res) => {
    const id = Number(req.params.id);
    const atual = db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(id);
    if (!atual) return res.status(404).json({ erro: 'Registro não encontrado.' });
    const usos = db.prepare(`SELECT COUNT(*) n FROM atendimentos WHERE ${def.fk} = ?`).get(id).n
      + db.prepare(`SELECT COUNT(*) n FROM folhas WHERE ${def.fk} = ?`).get(id).n;
    if (usos) {
      // Mantém o histórico: quem já tem atendimentos é só inativado.
      db.prepare(`UPDATE ${tabela} SET ativo = 0, atualizado_em = datetime('now') WHERE id = ?`).run(id);
      auditar(req, `inativou ${def.rotulo}`, atual.nome);
      return res.json({ inativado: true });
    }
    db.prepare(`DELETE FROM ${tabela} WHERE id = ?`).run(id);
    auditar(req, `excluiu ${def.rotulo}`, atual.nome);
    res.json({ excluido: true });
  });

  // Importação da planilha do Excel (lida no navegador): adiciona novos e atualiza os existentes pelo nome.
  app.post(`/api/${tabela}/importar`, exigirLogin, (req, res) => {
    const itens = Array.isArray(req.body?.itens) ? req.body.itens.slice(0, 5000) : [];
    const existentes = new Map(db.prepare(`SELECT * FROM ${tabela}`).all().map((r) => [chaveNome(r.nome), r]));
    let novos = 0, atualizados = 0, ignorados = 0;
    db.exec('BEGIN');
    try {
      for (const bruto of itens) {
        const item = limparItem(bruto);
        if (!item.nome) { ignorados++; continue; }
        const atual = existentes.get(chaveNome(item.nome));
        if (atual) {
          // Só preenche o que veio na planilha; não apaga dados já cadastrados.
          // Mantém a grafia do nome já cadastrado (é a que vale para os arquivos das folhas).
          const mesclado = def.campos.map((c) => (c === 'nome' ? atual.nome : item[c] ?? atual[c] ?? null));
          Object.assign(atual, Object.fromEntries(def.campos.map((c, i) => [c, mesclado[i]])));
          db.prepare(`UPDATE ${tabela} SET ${def.campos.map((c) => `${c} = ?`).join(', ')}, ativo = 1, atualizado_em = datetime('now') WHERE id = ?`)
            .run(...mesclado, atual.id);
          atualizados++;
        } else {
          const r = db.prepare(`INSERT INTO ${tabela} (${def.campos.join(', ')}) VALUES (${def.campos.map(() => '?').join(', ')})`).run(...def.campos.map((c) => item[c]));
          // Guarda o registro completo: o mesmo nome pode aparecer de novo mais abaixo na planilha.
          existentes.set(chaveNome(item.nome), { ...item, id: Number(r.lastInsertRowid) });
          novos++;
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    auditar(req, `importou ${tabela}`, `${novos} novos, ${atualizados} atualizados`);
    res.json({ novos, atualizados, ignorados });
  });
}

// ---------- planilha de atendimento ----------
const SQL_ATENDIMENTOS = `
  SELECT a.id, a.competencia, a.paciente_id, a.profissional_id, a.dias, a.observacao,
         p.nome AS paciente, pr.nome AS profissional, pr.categoria,
         f.arquivo AS folha_arquivo, f.origem AS folha_origem
  FROM atendimentos a
  JOIN pacientes p ON p.id = a.paciente_id
  JOIN profissionais pr ON pr.id = a.profissional_id
  LEFT JOIN folhas f ON f.competencia = a.competencia AND f.paciente_id = a.paciente_id AND f.profissional_id = a.profissional_id
  WHERE a.competencia = ?
  ORDER BY p.nome COLLATE NOCASE, pr.nome COLLATE NOCASE`;

app.get('/api/atendimentos', exigirLogin, (req, res) => {
  const c = req.query.competencia;
  if (!competenciaValida(c)) return res.status(400).json({ erro: 'Competência inválida.' });
  res.json(db.prepare(SQL_ATENDIMENTOS).all(c).map((r) => ({ ...r, dias: JSON.parse(r.dias || '{}') })));
});

app.post('/api/atendimentos', exigirLogin, (req, res) => {
  const { competencia } = req.body || {};
  const pid = Number(req.body?.paciente_id), prid = Number(req.body?.profissional_id);
  if (!competenciaValida(competencia)) return res.status(400).json({ erro: 'Competência inválida.' });
  const p = db.prepare('SELECT nome FROM pacientes WHERE id = ?').get(pid);
  const pr = db.prepare('SELECT nome FROM profissionais WHERE id = ?').get(prid);
  if (!p || !pr) return res.status(400).json({ erro: 'Escolha um paciente e um profissional cadastrados.' });
  const r = db.prepare('INSERT OR IGNORE INTO atendimentos (competencia, paciente_id, profissional_id) VALUES (?, ?, ?)').run(competencia, pid, prid);
  if (!r.changes) return res.status(409).json({ erro: 'Essa dupla paciente + profissional já está na planilha deste mês.' });
  auditar(req, 'incluiu linha na planilha', `${competencia}: ${p.nome} / ${pr.nome}`);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put('/api/atendimentos/:id', exigirLogin, (req, res) => {
  const id = Number(req.params.id);
  const atual = db.prepare('SELECT * FROM atendimentos WHERE id = ?').get(id);
  if (!atual) return res.status(404).json({ erro: 'Linha não encontrada.' });
  const max = diasNoMes(atual.competencia);
  const dias = {};
  for (const [d, v] of Object.entries(req.body?.dias || {})) {
    const n = Number(d);
    const valor = String(v ?? '').trim().toUpperCase().slice(0, 4);
    if (Number.isInteger(n) && n >= 1 && n <= max && valor) dias[n] = valor;
  }
  const observacao = req.body?.observacao === undefined ? atual.observacao : texto(req.body.observacao, 300);
  db.prepare("UPDATE atendimentos SET dias = ?, observacao = ?, atualizado_em = datetime('now') WHERE id = ?")
    .run(JSON.stringify(dias), observacao, id);
  res.json({ ok: true });
});

app.delete('/api/atendimentos/:id', exigirLogin, (req, res) => {
  const r = db.prepare(`SELECT a.competencia, p.nome paciente, pr.nome profissional FROM atendimentos a
    JOIN pacientes p ON p.id = a.paciente_id JOIN profissionais pr ON pr.id = a.profissional_id WHERE a.id = ?`).get(Number(req.params.id));
  if (!r) return res.status(404).json({ erro: 'Linha não encontrada.' });
  db.prepare('DELETE FROM atendimentos WHERE id = ?').run(Number(req.params.id));
  auditar(req, 'removeu linha da planilha', `${r.competencia}: ${r.paciente} / ${r.profissional}`);
  res.json({ ok: true });
});

// Copia as duplas (sem os dias) de um mês para outro.
app.post('/api/atendimentos/copiar', exigirLogin, (req, res) => {
  const { de, para } = req.body || {};
  if (!competenciaValida(de) || !competenciaValida(para) || de === para) return res.status(400).json({ erro: 'Competências inválidas.' });
  const r = db.prepare(`INSERT OR IGNORE INTO atendimentos (competencia, paciente_id, profissional_id)
    SELECT ?, a.paciente_id, a.profissional_id FROM atendimentos a
    JOIN pacientes p ON p.id = a.paciente_id AND p.ativo = 1
    JOIN profissionais pr ON pr.id = a.profissional_id AND pr.ativo = 1
    WHERE a.competencia = ?`).run(para, de);
  auditar(req, 'copiou planilha', `${de} → ${para}: ${r.changes} linhas`);
  res.json({ copiadas: r.changes });
});

// ---------- folhas / conferência ----------
app.get('/api/folhas', exigirLogin, (req, res) => {
  const c = req.query.competencia;
  if (!competenciaValida(c)) return res.status(400).json({ erro: 'Competência inválida.' });
  res.json({
    folhas: db.prepare('SELECT * FROM folhas WHERE competencia = ?').all(c),
    ultima: db.prepare('SELECT * FROM conferencias WHERE competencia = ? ORDER BY id DESC LIMIT 1').get(c) || null,
  });
});

// Registra o resultado da conferência da pasta: as folhas encontradas substituem as da conferência anterior
// (as marcadas manualmente são mantidas).
app.post('/api/folhas/conferencia', exigirLogin, (req, res) => {
  const { competencia, resumo } = req.body || {};
  if (!competenciaValida(competencia)) return res.status(400).json({ erro: 'Competência inválida.' });
  const encontradas = Array.isArray(req.body?.encontradas) ? req.body.encontradas.slice(0, 5000) : [];
  const existePac = db.prepare('SELECT 1 FROM pacientes WHERE id = ?');
  const existePro = db.prepare('SELECT 1 FROM profissionais WHERE id = ?');
  db.exec('BEGIN');
  try {
    db.prepare("DELETE FROM folhas WHERE competencia = ? AND origem = 'pasta'").run(competencia);
    const ins = db.prepare(`INSERT INTO folhas (competencia, paciente_id, profissional_id, arquivo, origem, usuario)
      VALUES (?, ?, ?, ?, 'pasta', ?)
      ON CONFLICT (competencia, paciente_id, profissional_id) DO UPDATE SET arquivo = excluded.arquivo, atualizado_em = datetime('now')`);
    for (const e of encontradas) {
      const pid = Number(e.paciente_id), prid = Number(e.profissional_id);
      if (!existePac.get(pid) || !existePro.get(prid)) continue;
      ins.run(competencia, pid, prid, texto(e.arquivo, 255), req.usuario.login);
    }
    const n = (k) => Math.max(0, Number(resumo?.[k]) || 0);
    db.prepare('INSERT INTO conferencias (competencia, usuario, total_arquivos, reconhecidos, pendencias, faltando) VALUES (?, ?, ?, ?, ?, ?)')
      .run(competencia, req.usuario.login, n('total'), n('reconhecidos'), n('pendencias'), n('faltando'));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  auditar(req, 'salvou conferência de folhas', `${competencia}: ${encontradas.length} folhas reconhecidas`);
  res.json({ ok: true });
});

app.post('/api/folhas/marcar', exigirLogin, (req, res) => {
  const { competencia, recebida } = req.body || {};
  const pid = Number(req.body?.paciente_id), prid = Number(req.body?.profissional_id);
  if (!competenciaValida(competencia)) return res.status(400).json({ erro: 'Competência inválida.' });
  const nomes = db.prepare('SELECT p.nome pa, pr.nome pr FROM pacientes p, profissionais pr WHERE p.id = ? AND pr.id = ?').get(pid, prid);
  if (!nomes) return res.status(400).json({ erro: 'Paciente/profissional não encontrado.' });
  if (recebida) {
    db.prepare(`INSERT INTO folhas (competencia, paciente_id, profissional_id, arquivo, origem, usuario) VALUES (?, ?, ?, ?, 'manual', ?)
      ON CONFLICT (competencia, paciente_id, profissional_id) DO NOTHING`)
      .run(competencia, pid, prid, texto(req.body?.arquivo, 255), req.usuario.login);
  } else {
    db.prepare('DELETE FROM folhas WHERE competencia = ? AND paciente_id = ? AND profissional_id = ?').run(competencia, pid, prid);
  }
  auditar(req, recebida ? 'marcou folha como recebida' : 'desmarcou folha', `${competencia}: ${nomes.pa} / ${nomes.pr}`);
  res.json({ ok: true });
});

// ---------- painel ----------
app.get('/api/painel', exigirLogin, (req, res) => {
  const c = req.query.competencia;
  if (!competenciaValida(c)) return res.status(400).json({ erro: 'Competência inválida.' });
  const linhas = db.prepare(SQL_ATENDIMENTOS).all(c);
  let atendimentos = 0;
  for (const l of linhas) for (const v of Object.values(JSON.parse(l.dias || '{}'))) atendimentos += valorDia(v);
  const historico = db.prepare(`
    SELECT a.competencia, COUNT(*) AS esperadas, SUM(CASE WHEN f.paciente_id IS NULL THEN 0 ELSE 1 END) AS recebidas
    FROM atendimentos a
    LEFT JOIN folhas f ON f.competencia = a.competencia AND f.paciente_id = a.paciente_id AND f.profissional_id = a.profissional_id
    GROUP BY a.competencia ORDER BY a.competencia DESC LIMIT 6`).all();
  res.json({
    pacientes: db.prepare('SELECT COUNT(*) n FROM pacientes WHERE ativo = 1').get().n,
    profissionais: db.prepare('SELECT COUNT(*) n FROM profissionais WHERE ativo = 1').get().n,
    linhas: linhas.length,
    recebidas: linhas.filter((l) => l.folha_origem).length,
    atendimentos,
    faltando: linhas.filter((l) => !l.folha_origem).map((l) => ({ paciente: l.paciente, profissional: l.profissional })),
    ultimaConferencia: db.prepare('SELECT * FROM conferencias WHERE competencia = ? ORDER BY id DESC LIMIT 1').get(c) || null,
    historico,
  });
});

/** Valor de um dia na planilha: número = quantidade; "X" = 1; outros códigos (F = falta…) = 0. */
function valorDia(v) {
  const s = String(v ?? '').trim().toUpperCase().replace(',', '.');
  if (!s) return 0;
  if (s === 'X') return 1;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ---------- documentos e PDFs ----------
app.get('/api/documentos', exigirLogin, (req, res) => {
  res.json(db.prepare('SELECT id, titulo, destinatario, usuario, criado_em, atualizado_em FROM documentos ORDER BY atualizado_em DESC').all());
});
app.get('/api/documentos/:id', exigirLogin, (req, res) => {
  const d = db.prepare('SELECT * FROM documentos WHERE id = ?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ erro: 'Documento não encontrado.' });
  res.json(d);
});

const lerDoc = (b) => ({
  titulo: texto(b?.titulo, 200),
  destinatario: textoLongo(b?.destinatario, 500),
  corpo: textoLongo(b?.corpo, 20000) || '',
  local_data: texto(b?.local_data, 200),
  assinatura: textoLongo(b?.assinatura, 300),
});

app.post('/api/documentos', exigirLogin, (req, res) => {
  const d = lerDoc(req.body);
  if (!d.titulo) return res.status(400).json({ erro: 'Informe o título do documento.' });
  const r = db.prepare('INSERT INTO documentos (titulo, destinatario, corpo, local_data, assinatura, usuario) VALUES (?, ?, ?, ?, ?, ?)')
    .run(d.titulo, d.destinatario, d.corpo, d.local_data, d.assinatura, req.usuario.login);
  auditar(req, 'criou documento', d.titulo);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/documentos/:id', exigirLogin, (req, res) => {
  const d = lerDoc(req.body);
  if (!d.titulo) return res.status(400).json({ erro: 'Informe o título do documento.' });
  const r = db.prepare("UPDATE documentos SET titulo = ?, destinatario = ?, corpo = ?, local_data = ?, assinatura = ?, atualizado_em = datetime('now') WHERE id = ?")
    .run(d.titulo, d.destinatario, d.corpo, d.local_data, d.assinatura, Number(req.params.id));
  if (!r.changes) return res.status(404).json({ erro: 'Documento não encontrado.' });
  auditar(req, 'alterou documento', d.titulo);
  res.json({ ok: true });
});
app.delete('/api/documentos/:id', exigirLogin, (req, res) => {
  const d = db.prepare('SELECT titulo FROM documentos WHERE id = ?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ erro: 'Documento não encontrado.' });
  db.prepare('DELETE FROM documentos WHERE id = ?').run(Number(req.params.id));
  auditar(req, 'excluiu documento', d.titulo);
  res.json({ ok: true });
});

app.get('/api/documentos/:id/pdf', exigirLogin, a(async (req, res) => {
  const d = db.prepare('SELECT * FROM documentos WHERE id = ?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ erro: 'Documento não encontrado.' });
  enviarPdf(res, await gerarDocumento({ cfg: lerConfig(), logo: lerLogo(), doc: d }), `${d.titulo}.pdf`);
}));

// Pré-visualização sem salvar
app.post('/api/pdf/documento', exigirLogin, a(async (req, res) => {
  const d = lerDoc(req.body);
  enviarPdf(res, await gerarDocumento({ cfg: lerConfig(), logo: lerLogo(), doc: d }), `${d.titulo || 'documento'}.pdf`);
}));

app.get('/api/pdf/timbrado', exigirLogin, a(async (req, res) => {
  const orientacao = req.query.orientacao === 'paisagem' ? 'paisagem' : 'retrato';
  const bytes = await gerarTimbradoEmBranco({ cfg: lerConfig(), logo: lerLogo(), paginas: Number(req.query.paginas) || 1, orientacao });
  auditar(req, 'gerou papel timbrado');
  enviarPdf(res, bytes, 'Papel timbrado - Hessel Domiciliar.pdf');
}));

app.post('/api/pdf/tabela', exigirLogin, a(async (req, res) => {
  const tabela = req.body || {};
  if (!Array.isArray(tabela.colunas) || !tabela.colunas.length) return res.status(400).json({ erro: 'Tabela sem colunas.' });
  const bytes = await gerarTabela({ cfg: lerConfig(), logo: lerLogo(), tabela });
  auditar(req, 'gerou PDF de tabela', tabela.titulo || '');
  enviarPdf(res, bytes, `${tabela.titulo || 'tabela'}.pdf`);
}));

// ---------- administração ----------
app.get('/api/admin/usuarios', exigirAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, nome, login, perfil, ativo, ultimo_acesso, criado_em FROM usuarios ORDER BY nome COLLATE NOCASE').all());
});

app.post('/api/admin/usuarios', exigirAdmin, (req, res) => {
  const nome = texto(req.body?.nome, 120), login = texto(req.body?.login, 80);
  const perfil = req.body?.perfil === 'admin' ? 'admin' : 'operador';
  const senha = String(req.body?.senha || '');
  if (!nome || !login) return res.status(400).json({ erro: 'Informe nome e login.' });
  if (senha.length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
  if (db.prepare('SELECT 1 FROM usuarios WHERE login = ?').get(login)) return res.status(409).json({ erro: 'Esse login já existe.' });
  const r = db.prepare('INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?, ?, ?, ?)').run(nome, login, hashSenha(senha), perfil);
  auditar(req, 'criou usuário', `${login} (${perfil})`);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put('/api/admin/usuarios/:id', exigirAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!u) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  const nome = texto(req.body?.nome, 120) || u.nome;
  const perfil = req.body?.perfil ? (req.body.perfil === 'admin' ? 'admin' : 'operador') : u.perfil;
  const ativo = req.body?.ativo === undefined ? u.ativo : (req.body.ativo ? 1 : 0);
  if (id === req.usuario.id && (perfil !== 'admin' || !ativo)) return res.status(400).json({ erro: 'Você não pode remover o seu próprio acesso de administrador.' });
  if (u.perfil === 'admin' && (perfil !== 'admin' || !ativo)) {
    const outros = db.prepare("SELECT COUNT(*) n FROM usuarios WHERE perfil = 'admin' AND ativo = 1 AND id <> ?").get(id).n;
    if (!outros) return res.status(400).json({ erro: 'É preciso manter pelo menos um administrador ativo.' });
  }
  db.prepare('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ? WHERE id = ?').run(nome, perfil, ativo, id);
  let senha = '';
  if (req.body?.senha) {
    if (String(req.body.senha).length < 8) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(req.body.senha), id);
    senha = ', senha redefinida';
  }
  auditar(req, 'alterou usuário', `${u.login}: ${perfil}, ${ativo ? 'ativo' : 'bloqueado'}${senha}`);
  res.json({ ok: true });
});

app.put('/api/admin/config', exigirAdmin, (req, res) => {
  const permitidas = ['empresa_nome', 'empresa_subtitulo', 'empresa_cnpj', 'empresa_endereco', 'empresa_telefone',
    'empresa_email', 'empresa_site', 'rodape_extra', 'categorias'];
  const up = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor');
  for (const k of permitidas) if (k in (req.body || {})) up.run(k, texto(req.body[k], 600) || '');
  auditar(req, 'alterou dados do papel timbrado');
  res.json({ ok: true });
});

const uploadLogo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });
app.post('/api/admin/logo', exigirAdmin, uploadLogo.single('logo'), (req, res) => {
  const b = req.file?.buffer;
  const png = b && b[0] === 0x89 && b[1] === 0x50;
  const jpg = b && b[0] === 0xff && b[1] === 0xd8;
  if (!png && !jpg) return res.status(400).json({ erro: 'Envie uma imagem PNG ou JPG.' });
  for (const ext of ['png', 'jpg']) fs.rmSync(path.join(DATA_DIR, `logo.${ext}`), { force: true });
  fs.writeFileSync(path.join(DATA_DIR, `logo.${png ? 'png' : 'jpg'}`), b);
  auditar(req, 'trocou o logo');
  res.json({ ok: true });
});
app.delete('/api/admin/logo', exigirAdmin, (req, res) => {
  for (const ext of ['png', 'jpg']) fs.rmSync(path.join(DATA_DIR, `logo.${ext}`), { force: true });
  auditar(req, 'restaurou o logo padrão');
  res.json({ ok: true });
});

app.get('/api/admin/auditoria', exigirAdmin, (req, res) => {
  const q = `%${texto(req.query.q, 100) || ''}%`;
  const limite = Math.min(Number(req.query.limite) || 300, 2000);
  res.json(db.prepare(`SELECT * FROM auditoria WHERE usuario LIKE ? OR acao LIKE ? OR detalhe LIKE ? ORDER BY id DESC LIMIT ?`).all(q, q, q, limite));
});

app.get('/api/admin/sistema', exigirAdmin, (req, res) => {
  const conta = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  res.json({
    usuarios: conta('usuarios'), pacientes: conta('pacientes'), profissionais: conta('profissionais'),
    atendimentos: conta('atendimentos'), folhas: conta('folhas'), documentos: conta('documentos'),
    conferencias: db.prepare('SELECT * FROM conferencias ORDER BY id DESC LIMIT 10').all(),
    competencias: db.prepare('SELECT DISTINCT competencia FROM atendimentos ORDER BY competencia DESC').all().map((r) => r.competencia),
    tamanhoBanco: fs.statSync(DB_FILE).size,
    node: process.version,
    iniciadoEm: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  });
});

app.get('/api/admin/backup', exigirAdmin, (req, res) => {
  const destino = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  auditar(req, 'baixou backup do banco');
  const nome = `hessel-backup-${new Date().toISOString().slice(0, 10)}.db`;
  res.download(destino, nome, () => fs.rmSync(destino, { force: true }));
});

// Exclui todas as linhas e folhas de uma competência (ex.: mês montado por engano).
app.delete('/api/admin/competencia/:c', exigirAdmin, (req, res) => {
  const c = req.params.c;
  if (!competenciaValida(c)) return res.status(400).json({ erro: 'Competência inválida.' });
  const n = db.prepare('DELETE FROM atendimentos WHERE competencia = ?').run(c).changes;
  db.prepare('DELETE FROM folhas WHERE competencia = ?').run(c);
  db.prepare('DELETE FROM conferencias WHERE competencia = ?').run(c);
  auditar(req, 'excluiu competência', `${c}: ${n} linhas`);
  res.json({ removidas: n });
});

// ---------- estáticos ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ erro: err.type === 'entity.too.large' ? 'Conteúdo grande demais.' : 'Erro interno. Tente novamente.' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Hessel Domiciliar rodando em http://localhost:${PORT}`));
}

module.exports = { app, valorDia };
