// Banco de dados SQLite (módulo nativo node:sqlite, sem dependências nativas).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'hessel.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  login      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  perfil     TEXT NOT NULL DEFAULT 'operador' CHECK (perfil IN ('admin', 'operador')),
  ativo      INTEGER NOT NULL DEFAULT 1,
  ultimo_acesso TEXT,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pacientes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  cpf        TEXT,
  nascimento TEXT,
  telefone   TEXT,
  responsavel TEXT,
  endereco   TEXT,
  convenio   TEXT,
  observacoes TEXT,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profissionais (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  cpf        TEXT,
  categoria  TEXT,
  registro   TEXT,
  telefone   TEXT,
  email      TEXT,
  chave_pix  TEXT,
  observacoes TEXT,
  ativo      INTEGER NOT NULL DEFAULT 1,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Planilha de atendimento: uma linha por paciente + profissional em cada competência (AAAA-MM).
-- dias = JSON {"1": "1", "2": "X", ...}
CREATE TABLE IF NOT EXISTS atendimentos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia    TEXT NOT NULL,
  paciente_id    INTEGER NOT NULL REFERENCES pacientes(id),
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  dias           TEXT NOT NULL DEFAULT '{}',
  observacao     TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (competencia, paciente_id, profissional_id)
);

-- Folhas já recebidas/salvas na pasta (resultado da conferência ou marcação manual).
CREATE TABLE IF NOT EXISTS folhas (
  competencia     TEXT NOT NULL,
  paciente_id     INTEGER NOT NULL REFERENCES pacientes(id),
  profissional_id INTEGER NOT NULL REFERENCES profissionais(id),
  arquivo         TEXT,
  origem          TEXT NOT NULL DEFAULT 'pasta' CHECK (origem IN ('pasta', 'manual')),
  usuario         TEXT,
  atualizado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (competencia, paciente_id, profissional_id)
);

CREATE TABLE IF NOT EXISTS conferencias (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  competencia  TEXT NOT NULL,
  usuario      TEXT,
  total_arquivos INTEGER NOT NULL DEFAULT 0,
  reconhecidos INTEGER NOT NULL DEFAULT 0,
  pendencias   INTEGER NOT NULL DEFAULT 0,
  faltando     INTEGER NOT NULL DEFAULT 0,
  criado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo      TEXT NOT NULL,
  destinatario TEXT,
  corpo       TEXT NOT NULL DEFAULT '',
  local_data  TEXT,
  assinatura  TEXT,
  usuario     TEXT,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS auditoria (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario   TEXT,
  acao      TEXT NOT NULL,
  detalhe   TEXT,
  ip        TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_atend_comp ON atendimentos(competencia);
CREATE INDEX IF NOT EXISTS idx_folhas_comp ON folhas(competencia);
CREATE INDEX IF NOT EXISTS idx_auditoria_data ON auditoria(criado_em);
`);

// Dados padrão do papel timbrado (editáveis na tela de admin).
const CONFIG_PADRAO = {
  empresa_nome: 'Hessel Domiciliar',
  empresa_subtitulo: 'Atenção domiciliar',
  empresa_cnpj: '',
  empresa_endereco: '',
  empresa_telefone: '',
  empresa_email: '',
  empresa_site: '',
  rodape_extra: '',
  categorias: 'Enfermeiro(a), Técnico(a) de enfermagem, Cuidador(a), Fisioterapeuta, Fonoaudiólogo(a), Nutricionista, Psicólogo(a), Terapeuta ocupacional, Médico(a)',
};
const insCfg = db.prepare('INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)');
for (const [k, v] of Object.entries(CONFIG_PADRAO)) insCfg.run(k, v);

function lerConfig() {
  const out = {};
  for (const r of db.prepare('SELECT chave, valor FROM config').all()) out[r.chave] = r.valor ?? '';
  return out;
}

// ---------- senhas (scrypt) ----------
function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), sal, 64);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}

function conferirSenha(senha, armazenado) {
  const [tipo, salHex, hHex] = String(armazenado || '').split('$');
  if (tipo !== 'scrypt' || !salHex || !hHex) return false;
  const h = crypto.scryptSync(String(senha), Buffer.from(salHex, 'hex'), 64);
  const esperado = Buffer.from(hHex, 'hex');
  return esperado.length === h.length && crypto.timingSafeEqual(h, esperado);
}

module.exports = { db, DATA_DIR, DB_FILE, lerConfig, hashSenha, conferirSenha, CONFIG_PADRAO };
