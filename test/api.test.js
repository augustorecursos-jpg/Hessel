const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hessel-'));
const { app } = require('../server');

let base, cookie = '';
const req = async (metodo, url, corpo) => {
  const r = await fetch(base + url, { method: metodo, headers: { 'Content-Type': 'application/json', cookie }, body: corpo && JSON.stringify(corpo) });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, dados: tipo.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};

test('fluxo completo', async (t) => {
  const srv = app.listen(0);
  base = `http://localhost:${srv.address().port}`;
  t.after(() => srv.close());

  assert.equal((await req('GET', '/api/pacientes')).status, 401);
  assert.equal((await req('POST', '/api/login', { login: 'admin', senha: 'errada' })).status, 401);
  assert.equal((await req('POST', '/api/login', { login: 'admin', senha: 'hessel-admin' })).status, 200);

  const p = (await req('POST', '/api/pacientes', { nome: 'Maria Souza' })).dados.id;
  assert.equal((await req('POST', '/api/pacientes', { nome: 'maria  SOUZA' })).status, 409);
  const imp = (await req('POST', '/api/profissionais/importar', { itens: [{ nome: 'Ana Lima', categoria: 'Cuidador(a)' }, { nome: '' }] })).dados;
  assert.deepEqual(imp, { novos: 1, atualizados: 0, ignorados: 1 });
  const r = (await req('GET', '/api/profissionais')).dados[0].id;

  const linha = (await req('POST', '/api/atendimentos', { competencia: '2026-02', paciente_id: p, profissional_id: r })).dados.id;
  assert.equal((await req('POST', '/api/atendimentos', { competencia: '2026-02', paciente_id: p, profissional_id: r })).status, 409);
  await req('PUT', `/api/atendimentos/${linha}`, { dias: { 1: '2', 2: 'x', 3: 'F', 30: '1' } });
  const at = (await req('GET', '/api/atendimentos?competencia=2026-02')).dados[0];
  assert.deepEqual(at.dias, { 1: '2', 2: 'X', 3: 'F' }); // fevereiro não tem dia 30

  let painel = (await req('GET', '/api/painel?competencia=2026-02')).dados;
  assert.equal(painel.atendimentos, 3);
  assert.equal(painel.faltando.length, 1);

  await req('POST', '/api/folhas/conferencia', { competencia: '2026-02', encontradas: [{ paciente_id: p, profissional_id: r, arquivo: 'x.pdf' }], resumo: { total: 1 } });
  painel = (await req('GET', '/api/painel?competencia=2026-02')).dados;
  assert.equal(painel.recebidas, 1);

  assert.equal((await req('POST', '/api/atendimentos/copiar', { de: '2026-02', para: '2026-03' })).dados.copiadas, 1);
  assert.equal((await req('DELETE', `/api/pacientes/${p}`)).dados.inativado, true);

  for (const [m, u, b] of [['GET', '/api/pdf/timbrado'], ['POST', '/api/pdf/documento', { titulo: 'Declaração', corpo: 'Texto ção ✓ 😀\n\nOutro parágrafo '.repeat(80), assinatura: 'Fulana\nCargo' }],
    ['POST', '/api/pdf/tabela', { titulo: 'Planilha', orientacao: 'paisagem', colunas: [{ titulo: 'A' }, { titulo: '1', largura: 15 }], linhas: Array.from({ length: 120 }, (_, i) => ['Nome ' + i, '1']) }]]) {
    const res = await req(m, u, b);
    assert.equal(res.status, 200, u);
    assert.equal(res.dados.subarray(0, 4).toString(), '%PDF');
  }

  // operador não acessa a administração
  await req('POST', '/api/admin/usuarios', { nome: 'Op', login: 'op', senha: 'senha1234', perfil: 'operador' });
  await req('POST', '/api/logout');
  cookie = '';
  await req('POST', '/api/login', { login: 'op', senha: 'senha1234' });
  assert.equal((await req('GET', '/api/admin/usuarios')).status, 403);
  assert.equal((await req('GET', '/api/pacientes')).status, 200);
});
