// Dados de demonstração: pacientes, profissionais e a planilha do mês atual.
const { db } = require('../db');

const pacientes = ['Maria da Silva Souza', 'José Carlos Pereira', 'Antônia Ferreira Lima', 'João Batista Oliveira', 'Helena Martins Costa'];
const profissionais = [
  ['Ana Paula Rodrigues', 'Técnico(a) de enfermagem', 'COREN-SP 123456'],
  ['Carlos Eduardo Santos', 'Fisioterapeuta', 'CREFITO-3 98765-F'],
  ['Fernanda Gonçalves', 'Enfermeiro(a)', 'COREN-SP 654321'],
  ['Juliana Alves', 'Cuidador(a)', ''],
  ['Ricardo Nogueira', 'Fonoaudiólogo(a)', 'CRFa 2-11111'],
];

const insP = db.prepare('INSERT INTO pacientes (nome, convenio) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM pacientes WHERE nome = ?)');
pacientes.forEach((n, i) => insP.run(n, i % 2 ? 'Particular' : 'Unimed', n));
const insR = db.prepare('INSERT INTO profissionais (nome, categoria, registro) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM profissionais WHERE nome = ?)');
profissionais.forEach(([n, c, r]) => insR.run(n, c, r, n));

const d = new Date();
const comp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const idP = (n) => db.prepare('SELECT id FROM pacientes WHERE nome = ?').get(n).id;
const idR = (n) => db.prepare('SELECT id FROM profissionais WHERE nome = ?').get(profissionais.find((p) => p[0].startsWith(n))[0]).id;
const duplas = [['Maria da Silva Souza', 'Ana Paula'], ['Maria da Silva Souza', 'Carlos'], ['José Carlos Pereira', 'Fernanda'],
  ['Antônia Ferreira Lima', 'Juliana'], ['João Batista Oliveira', 'Ana Paula'], ['Helena Martins Costa', 'Ricardo']];
const ins = db.prepare('INSERT OR IGNORE INTO atendimentos (competencia, paciente_id, profissional_id, dias) VALUES (?, ?, ?, ?)');
for (const [p, r] of duplas) {
  const dias = {};
  for (let i = 1; i <= 20; i++) if (i % 7 && i % 7 !== 6) dias[i] = i % 5 === 0 ? 'F' : '1';
  ins.run(comp, idP(p), idR(r), JSON.stringify(dias));
}
console.log(`Demonstração criada (competência ${comp}).`);
