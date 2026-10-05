const test = require('node:test');
const assert = require('node:assert');
const C = require('../public/js/conferencia.js');

const pacientes = [{ id: 1, nome: 'Maria da Silva Souza' }, { id: 2, nome: 'José Carlos Pereira' }, { id: 3, nome: 'Ana' }, { id: 4, nome: 'Ana Paula Lima' }];
const profissionais = [{ id: 10, nome: 'Fernanda Gonçalves' }, { id: 11, nome: 'Carlos Eduardo Santos' }];
const esperados = [{ paciente_id: 1, profissional_id: 10 }, { paciente_id: 2, profissional_id: 11 }, { paciente_id: 4, profissional_id: 10 }];
const rodar = (arquivos) => C.conferir({ arquivos, pacientes, profissionais, esperados });
const st = (r, arq) => r.itens.find((i) => i.arquivo === arq)?.status;

test('nome correto é reconhecido e some da lista de faltando', () => {
  const r = rodar(['Paciente Maria da Silva Souza - Profissional Fernanda Gonçalves.pdf']);
  assert.equal(r.itens[0].status, 'ok');
  assert.equal(r.faltando.length, 2);
  assert.deepEqual(r.faltando.map((f) => f.paciente_id).sort(), [2, 4]);
});

test('acentos e maiúsculas diferentes: reconhece e sugere a grafia do cadastro', () => {
  const a = 'Paciente maria da silva souza - Profissional Fernanda Goncalves.pdf';
  const r = rodar([a]);
  assert.equal(st(r, a), 'grafia');
  assert.equal(r.itens[0].sugestao, 'Paciente Maria da Silva Souza - Profissional Fernanda Gonçalves.pdf');
  assert.equal(r.encontradas.length, 1);
});

test('erro de digitação vira sugestão; nome desconhecido fica como não cadastrado', () => {
  const a = 'Paciente Jose Carlos Pereria - Profissional Carlos Eduardo Santos.pdf';
  const b = 'Paciente Fulano de Tal - Profissional Carlos Eduardo Santos.pdf';
  const r = rodar([a, b]);
  assert.equal(st(r, a), 'grafia');
  assert.equal(st(r, b), 'nao_cadastrado');
});

test('nome fora do padrão é identificado pelos nomes', () => {
  const a = 'pac. Maria da Silva Souza – prof Fernanda Gonçalves.PDF';
  const b = 'folha Fernanda Gonçalves Maria da Silva Souza.pdf';
  const c = 'scan001.pdf';
  const r = rodar([a, b, c]);
  assert.equal(st(r, a), 'fora_padrao');
  assert.equal(r.itens[0].sugestao, 'Paciente Maria da Silva Souza - Profissional Fernanda Gonçalves.PDF');
  assert.equal(st(r, b), 'duplicado');
  assert.equal(st(r, c), 'fora_padrao');
});

test('prefere o nome mais longo (Ana Paula Lima e não Ana)', () => {
  const r = rodar(['Ana Paula Lima Fernanda Gonçalves.pdf']);
  assert.equal(r.itens[0].paciente.id, 4);
});

test('dupla fora da planilha e arquivos de sistema ignorados', () => {
  const a = 'Paciente Ana - Profissional Fernanda Gonçalves.pdf';
  const r = rodar([a, 'Thumbs.db', 'desktop.ini', '.DS_Store']);
  assert.equal(r.itens.length, 1);
  assert.equal(st(r, a), 'sem_planilha');
});

test('script de renomear só inclui arquivos com sugestão', () => {
  const r = rodar(['Paciente maria da silva souza - Profissional Fernanda Gonçalves.pdf', 'Paciente José Carlos Pereira - Profissional Carlos Eduardo Santos.pdf']);
  const s = C.scriptRenomear(r.itens);
  assert.equal(s.quantidade, 1);
  assert.match(s.texto, /chcp 65001/);
  assert.match(s.texto, /ren "Paciente maria da silva souza/);
});
