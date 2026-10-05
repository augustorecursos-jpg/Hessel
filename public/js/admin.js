// Área do administrador: usuários, dados do timbrado, auditoria e sistema.
let eu = null;

(async function iniciar() {
  try { eu = await api('/api/eu'); } catch { return; }
  if (eu.perfil !== 'admin') { location.href = '/app'; return; }
  $('#nome-usuario').textContent = eu.nome;
  $('#av-usuario').textContent = iniciais(eu.nome);
  $('#btn-sair').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; });
  window.addEventListener('hashchange', () => abrir(location.hash.slice(1)));
  abrir(location.hash.slice(1) || 'usuarios');
})();

const SECOES = { usuarios: carregarUsuarios, empresa: carregarEmpresa, auditoria: carregarAuditoria, sistema: carregarSistema };

function abrir(nome) {
  if (!SECOES[nome]) nome = 'usuarios';
  $$('section[data-secao]').forEach((s) => { s.hidden = s.dataset.secao !== nome; });
  $$('#menu a[data-secao]').forEach((a) => a.classList.toggle('ativo', a.dataset.secao === nome));
  SECOES[nome]().catch((e) => toast(e.message, true));
}

// ---------- usuários ----------
let usuarios = [];
async function carregarUsuarios() {
  usuarios = await api('/api/admin/usuarios');
  $('#u-tabela').innerHTML = `<table class="t"><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead><tbody>
    ${usuarios.map((u) => `<tr class="${u.ativo ? '' : 'inativo'}">
      <td><div class="linha">${pessoa(u.nome)}${u.id === eu.id ? '<span class="tag info">você</span>' : ''}</div></td>
      <td>${esc(u.login)}</td>
      <td><span class="tag ${u.perfil === 'admin' ? 'aviso' : 'info'}">${ic(u.perfil === 'admin' ? 'escudo' : 'usuario')} ${u.perfil === 'admin' ? 'Administrador' : 'Operador'}</span></td>
      <td>${u.ativo ? '<span class="tag ok">Ativo</span>' : `<span class="tag erro">${ic('cadeado')} Bloqueado</span>`}</td>
      <td>${u.ultimo_acesso ? esc(dataBR(u.ultimo_acesso)) : '<small>nunca</small>'}</td>
      <td class="acoes"><button class="btn sec peq" data-u="${u.id}">${ic('editar')} Editar</button></td></tr>`).join('')}
  </tbody></table>`;
  $$('[data-u]').forEach((b) => b.addEventListener('click', () => editarUsuario(usuarios.find((u) => u.id === Number(b.dataset.u)))));
}

$('#u-novo').addEventListener('click', () => editarUsuario(null));

function editarUsuario(u) {
  const m = modal(`<h2>${u ? 'Editar usuário' : 'Novo usuário'}</h2>
    <form id="f-u" class="grade-form">
      <div><label class="rotulo">Nome</label><input type="text" name="nome" required value="${esc(u?.nome || '')}"></div>
      <div><label class="rotulo">Login</label><input type="text" name="login" required value="${esc(u?.login || '')}" ${u ? 'disabled' : ''} autocomplete="off"></div>
      <div><label class="rotulo">Perfil</label><select name="perfil">
        <option value="operador" ${u?.perfil === 'operador' ? 'selected' : ''}>Operador</option>
        <option value="admin" ${u?.perfil === 'admin' ? 'selected' : ''}>Administrador</option></select></div>
      ${u ? `<div><label class="rotulo">Situação</label><select name="ativo"><option value="1" ${u.ativo ? 'selected' : ''}>Ativo</option><option value="0" ${u.ativo ? '' : 'selected'}>Bloqueado</option></select></div>` : ''}
      <div class="inteiro"><label class="rotulo">${u ? 'Nova senha <small>(deixe em branco para manter)</small>' : 'Senha <small>(mínimo 8 caracteres)</small>'}</label>
        <div class="linha"><input type="text" name="senha" class="cresce" ${u ? '' : 'required'} minlength="8" autocomplete="off"><button type="button" class="btn sec" id="b-gerar">Gerar senha</button></div></div>
    </form>
    <div class="rodape-modal"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" form="f-u">Salvar</button></div>`);
  $('#b-gerar', m.el).addEventListener('click', () => {
    const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint32Array(10));
    $('[name=senha]', m.el).value = [...r].map((n) => c[n % c.length]).join('');
  });
  $('#f-u', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try {
      if (u) await api(`/api/admin/usuarios/${u.id}`, { method: 'PUT', body: { nome: d.nome, perfil: d.perfil, ativo: d.ativo === '1', senha: d.senha || undefined } });
      else await api('/api/admin/usuarios', { method: 'POST', body: d });
      toast(d.senha ? `Salvo. Informe a senha ao usuário: ${d.senha}` : 'Salvo.');
      m.fechar();
      carregarUsuarios();
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- empresa ----------
async function carregarEmpresa() {
  const cfg = await api('/api/config');
  const f = $('#f-empresa');
  for (const el of f.elements) if (el.name) el.value = cfg[el.name] || '';
}
$('#f-empresa').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/config', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    toast('Dados salvos.');
  } catch (err) { toast(err.message, true); }
});
$('#emp-previa').addEventListener('click', () => abrirPdf('/api/pdf/timbrado', undefined, 'Papel timbrado.pdf'));
const recarregarLogo = () => $$('img[src^="/logo"]').forEach((i) => { i.src = `/logo?v=${Date.now()}`; });
$('#logo-arq').addEventListener('change', async (e) => {
  const arq = e.target.files[0];
  e.target.value = '';
  if (!arq) return;
  const fd = new FormData();
  fd.append('logo', arq);
  try { await api('/api/admin/logo', { method: 'POST', body: fd }); toast('Logo atualizado.'); recarregarLogo(); }
  catch (err) { toast(err.message, true); }
});
$('#logo-padrao').addEventListener('click', async () => {
  if (!await confirmar('Voltar a usar o logo padrão?', { botao: 'Restaurar' })) return;
  await api('/api/admin/logo', { method: 'DELETE' });
  toast('Logo padrão restaurado.');
  recarregarLogo();
});

// ---------- auditoria ----------
let audLista = [];
let audTimer;
async function carregarAuditoria() {
  audLista = await api(`/api/admin/auditoria?q=${encodeURIComponent($('#aud-busca').value)}&limite=1000`);
  $('#aud-tabela').innerHTML = audLista.length ? `<table class="t"><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    ${audLista.map((r) => `<tr><td style="white-space:nowrap">${esc(dataBR(r.criado_em))}</td><td>${esc(r.usuario)}</td><td>${esc(r.acao)}</td><td>${esc(r.detalhe)}</td></tr>`).join('')}
    </tbody></table>` : vazio({ ilustra: 'documento', titulo: 'Nenhum registro' });
}
$('#aud-busca').addEventListener('input', () => { clearTimeout(audTimer); audTimer = setTimeout(carregarAuditoria, 300); });
$('#aud-xlsx').addEventListener('click', () => exportarXlsx('Auditoria.xlsx', {
  aba: 'Auditoria',
  colunas: [{ titulo: 'Data', largura: 18 }, { titulo: 'Usuário', largura: 16 }, { titulo: 'Ação', largura: 30 }, { titulo: 'Detalhe', largura: 70 }, { titulo: 'IP', largura: 16 }],
  linhas: audLista.map((r) => [dataBR(r.criado_em), r.usuario, r.acao, r.detalhe, r.ip]),
}));

// ---------- sistema ----------
async function carregarSistema() {
  const s = await api('/api/admin/sistema');
  const kpi = (rot, val, icone, cor = '') => `<div class="kpi ${cor}"><div class="topo-kpi"><span class="rot">${rot}</span><span class="bolha ${cor}">${ic(icone)}</span></div><div class="val">${val}</div></div>`;
  $('#sis-kpis').innerHTML = kpi('Usuários', s.usuarios, 'usuarios', 'azul') + kpi('Pacientes', s.pacientes, 'coracao', 'coral') + kpi('Profissionais', s.profissionais, 'estetoscopio')
    + kpi('Linhas de planilha', s.atendimentos, 'tabela', 'ambar') + kpi('Folhas registradas', s.folhas, 'docOk') + kpi('Documentos', s.documentos, 'documento', 'azul');
  $('#sis-comp').innerHTML = s.competencias.length ? s.competencias.map((c) => `<option value="${c}">${esc(nomeCompetencia(c))}</option>`).join('') : '<option value="">— nenhuma —</option>';
  $('#sis-conf').innerHTML = s.conferencias.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Data</th><th>Competência</th><th>Usuário</th><th>Arquivos</th><th>Reconhecidos</th><th>Pendências no nome</th><th>Faltando</th></tr></thead><tbody>
    ${s.conferencias.map((c) => `<tr><td>${esc(dataBR(c.criado_em))}</td><td>${esc(nomeCompetencia(c.competencia))}</td><td>${esc(c.usuario)}</td><td>${c.total_arquivos}</td><td>${c.reconhecidos}</td><td>${c.pendencias}</td><td>${c.faltando}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="suave">Nenhuma conferência ainda.</p>';
  $('#sis-info').textContent = `Banco: ${(s.tamanhoBanco / 1024).toFixed(0)} KB · Node ${s.node} · no ar desde ${dataBR(s.iniciadoEm)}`;
}
$('#sis-excluir-comp').addEventListener('click', async () => {
  const c = $('#sis-comp').value;
  if (!c) return;
  if (!await confirmar(`Excluir TODA a planilha de atendimento e as folhas registradas de ${nomeCompetencia(c)}? Não dá para desfazer (faça um backup antes).`, { botao: 'Excluir', perigo: true })) return;
  try {
    const r = await api(`/api/admin/competencia/${c}`, { method: 'DELETE' });
    toast(`${r.removidas} linha(s) excluída(s).`);
    carregarSistema();
  } catch (e) { toast(e.message, true); }
});
