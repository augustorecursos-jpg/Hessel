// Tela da operação: painel, planilha de atendimento, conferência de folhas, cadastros e documentos.
const estado = {
  eu: null,
  cfg: {},
  comp: lsLer('hessel.competencia', competenciaAtual()),
  pacientes: [],
  profissionais: [],
  secao: null,
};

// ================= inicialização =================
(async function iniciar() {
  try {
    estado.eu = await api('/api/eu');
  } catch { return; }
  $('#nome-usuario').textContent = estado.eu.nome;
  $('#perfil-usuario').textContent = estado.eu.perfil === 'admin' ? 'Administrador' : 'Operador';
  $('#av-usuario').textContent = iniciais(estado.eu.nome);
  $('#saudacao').textContent = `${saudacao()}, ${estado.eu.nome.split(' ')[0]}!`;
  $('#hoje').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#link-admin').hidden = estado.eu.perfil !== 'admin';
  $('#aviso-senha-padrao').hidden = !estado.eu.padrao;
  estado.cfg = await api('/api/config');

  const inp = $('#competencia');
  const mudarComp = (c) => {
    if (!/^\d{4}-\d{2}$/.test(c)) return;
    estado.comp = c;
    inp.value = c;
    lsGravar('hessel.competencia', c);
    atualizarRotulosMes();
    cfResultado = null;
    abrirSecao(estado.secao, true);
  };
  inp.value = estado.comp;
  atualizarRotulosMes();
  inp.addEventListener('change', () => mudarComp(inp.value));
  $('#mes-ant').addEventListener('click', () => mudarComp(competenciaAnterior(estado.comp)));
  $('#mes-prox').addEventListener('click', () => {
    const [a, m] = estado.comp.split('-').map(Number);
    mudarComp(m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`);
  });

  $('#btn-sair').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); location.href = '/'; });
  $('#btn-senha').addEventListener('click', trocarSenha);
  $('#link-trocar-senha').addEventListener('click', (e) => { e.preventDefault(); trocarSenha(); });

  await carregarCadastros();
  atualizarContadorRemoto();
  window.addEventListener('hashchange', () => abrirSecao(location.hash.slice(1)));
  abrirSecao(location.hash.slice(1) || 'painel');
})();

const mesCapitalizado = (c) => { const n = nomeCompetencia(c); return n[0].toUpperCase() + n.slice(1); };

function atualizarRotulosMes() {
  const n = mesCapitalizado(estado.comp);
  $('#nome-comp').textContent = n;
  ['#painel-mes', '#pl-mes', '#cf-mes'].forEach((s) => { $(s).textContent = s === '#painel-mes' ? nomeCompetencia(estado.comp) : n; });
}

/** Número de folhas faltando no menu lateral. */
function atualizarContador(faltando) {
  const el = $('#cont-faltando');
  el.textContent = faltando;
  el.hidden = !faltando;
}

async function carregarCadastros() {
  [estado.pacientes, estado.profissionais] = await Promise.all([api('/api/pacientes'), api('/api/profissionais')]);
}

const CARREGADORES = {
  painel: carregarPainel,
  planilha: carregarPlanilha,
  conferencia: carregarConferencia,
  pacientes: () => renderCadastro('pacientes'),
  profissionais: () => renderCadastro('profissionais'),
  documentos: carregarDocumentos,
};

function abrirSecao(nome, forcar = false) {
  if (!CARREGADORES[nome]) nome = 'painel';
  if (estado.secao === nome && !forcar) return;
  estado.secao = nome;
  $$('section[data-secao]').forEach((s) => { s.hidden = s.dataset.secao !== nome; });
  $$('#menu a[data-secao]').forEach((a) => a.classList.toggle('ativo', a.dataset.secao === nome));
  if (location.hash.slice(1) !== nome) history.replaceState(null, '', `#${nome}`);
  CARREGADORES[nome]().catch((e) => toast(e.message, true));
}

function trocarSenha() {
  const m = modal(`<h2>Trocar senha</h2>
    <form id="f-senha" class="grade-form">
      <div class="inteiro"><label class="rotulo">Senha atual</label><input type="password" name="atual" required autocomplete="current-password"></div>
      <div><label class="rotulo">Nova senha</label><input type="password" name="nova" required minlength="8" autocomplete="new-password"></div>
      <div><label class="rotulo">Repita a nova senha</label><input type="password" name="nova2" required minlength="8" autocomplete="new-password"></div>
    </form>
    <div class="rodape-modal"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" form="f-senha">Salvar</button></div>`);
  $('#f-senha', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.nova.value !== f.nova2.value) return toast('As senhas não conferem.', true);
    try {
      await api('/api/eu/senha', { method: 'POST', body: { atual: f.atual.value, nova: f.nova.value } });
      toast('Senha alterada.');
      $('#aviso-senha-padrao').hidden = true;
      m.fechar();
    } catch (err) { toast(err.message, true); }
  });
}

const tituloEmpresa = () => estado.cfg.empresa_nome || 'Hessel Domiciliar';
const nomeArquivoComp = (prefixo) => `${prefixo} - ${estado.comp}`;

// ================= PAINEL =================
function kpi({ rot, val, det = '', icone, cor = '' }) {
  return `<div class="kpi ${cor}"><div class="topo-kpi"><span class="rot">${rot}</span><span class="bolha ${cor}">${ic(icone)}</span></div>
    <div class="val">${val}</div>${det ? `<div class="det">${det}</div>` : ''}</div>`;
}

async function atualizarContadorRemoto() {
  try { atualizarContador((await api(`/api/painel?competencia=${estado.comp}`)).faltando.length); } catch { /* ignora */ }
}

async function carregarPainel() {
  const p = await api(`/api/painel?competencia=${estado.comp}`);
  atualizarContador(p.faltando.length);
  const pct = p.linhas ? (p.recebidas / p.linhas) * 100 : 0;

  $('#painel-anel').innerHTML = `${anel(pct)}
    <div class="info">
      <h2>Folhas do mês</h2>
      <p>${p.linhas
        ? `<b>${p.recebidas}</b> de <b>${p.linhas}</b> folhas recebidas.${p.ultimaConferencia ? `<br>Última conferência: ${esc(dataBR(p.ultimaConferencia.criado_em))}` : '<br>A pasta ainda não foi conferida.'}`
        : 'A planilha deste mês ainda está vazia.'}</p>
      <div class="legenda-anel"><span><i></i> Recebidas ${p.recebidas}</span><span><i class="f"></i> Faltando ${p.faltando.length}</span></div>
      <a class="btn peq" href="#conferencia">${ic('pasta')} Conferir agora</a>
    </div>`;

  $('#kpis').innerHTML = [
    kpi({ rot: 'Pacientes ativos', val: p.pacientes, icone: 'coracao', cor: 'coral', det: 'em atendimento domiciliar' }),
    kpi({ rot: 'Profissionais', val: p.profissionais, icone: 'estetoscopio', det: 'prestadores ativos' }),
    kpi({ rot: 'Atendimentos', val: p.atendimentos.toLocaleString('pt-BR'), icone: 'atividade', cor: 'azul', det: `lançados em ${nomeCompetencia(estado.comp).split(' ')[0]}` }),
    kpi({ rot: 'Linhas na planilha', val: p.linhas, icone: 'tabela', cor: 'ambar', det: 'paciente + profissional' }),
  ].join('');

  $('#painel-faltando').innerHTML = !p.linhas
    ? vazio({ ilustra: 'calendario', titulo: 'Nenhuma folha esperada ainda', texto: `Monte a planilha de atendimento de ${esc(nomeCompetencia(estado.comp))} para o sistema saber quais folhas esperar.`, acoes: `<a class="btn" href="#planilha">${ic('calendario')} Montar planilha</a>` })
    : !p.faltando.length
      ? vazio({ ilustra: 'pasta', titulo: 'Tudo certo por aqui!', texto: 'Todas as folhas da planilha foram recebidas.' })
      : `<div class="lista-faltando">${p.faltando.slice(0, 10).map((f) => `<div class="item">${pessoa(f.paciente, 'Paciente')}${pessoa(f.profissional, 'Profissional')}
          <span class="tag erro">${ic('docX')} Faltando</span></div>`).join('')}</div>
        ${p.faltando.length > 10 ? `<p class="suave" style="margin-bottom:0">… e mais ${p.faltando.length - 10}. <a href="#conferencia">Ver todas</a></p>` : ''}`;

  const passos = [
    { feito: p.pacientes > 0 && p.profissionais > 0, titulo: 'Cadastros em dia', texto: 'Pacientes e profissionais cadastrados', link: '#pacientes' },
    { feito: p.linhas > 0, titulo: 'Montar a planilha de atendimento', texto: 'Uma linha por paciente + profissional', link: '#planilha' },
    { feito: !!p.ultimaConferencia, titulo: 'Conferir a pasta de folhas', texto: 'Ver o que falta e o que está com nome errado', link: '#conferencia' },
    { feito: p.linhas > 0 && !p.faltando.length, titulo: 'Todas as folhas recebidas', texto: 'Pronto para exportar e enviar', link: '#planilha' },
  ];
  $('#painel-passos').innerHTML = passos.map((x, i) => `<li class="${x.feito ? 'feito' : ''}"><span class="n">${x.feito ? ic('check') : i + 1}</span>
    <a href="${x.link}"><b>${x.titulo}</b><small>${x.texto}</small></a></li>`).join('');

  $('#painel-historico').innerHTML = !p.historico.length ? '<p class="suave" style="margin:0">Nenhuma competência registrada ainda.</p>'
    : `<div class="lista-faltando">${p.historico.map((h) => {
        const pc = h.esperadas ? Math.round((h.recebidas / h.esperadas) * 100) : 0;
        return `<div class="item" style="grid-template-columns:8.5em 1fr auto"><a href="#" data-comp="${h.competencia}"><b>${esc(mesCapitalizado(h.competencia))}</b></a>
          <div class="barra"><span style="width:${pc}%"></span></div><small><b>${h.recebidas}</b>/${h.esperadas}</small></div>`;
      }).join('')}</div>`;
  $$('#painel-historico [data-comp]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    $('#competencia').value = a.dataset.comp;
    $('#competencia').dispatchEvent(new Event('change'));
  }));
}

// ================= PLANILHA DE ATENDIMENTO =================
let plLinhas = [];
const plTimers = new Map();

async function carregarPlanilha() {
  plLinhas = await api(`/api/atendimentos?competencia=${estado.comp}`);
  renderPlanilha();
}

function classeDia(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!s) return '';
  return valorDia(s) > 0 ? 'cheio' : 'cod';
}

function totalLinha(l) { return Object.values(l.dias).reduce((s, v) => s + valorDia(v), 0); }

function renderPlanilha() {
  const n = diasDoMes(estado.comp);
  const busca = Conferencia.normalizar($('#pl-busca').value);
  const visiveis = plLinhas.filter((l) => !busca || Conferencia.normalizar(`${l.paciente} ${l.profissional}`).includes(busca));
  const fds = (d) => [0, 6].includes(diaDaSemana(estado.comp, d));
  const hoje = new Date();
  const diaHoje = estado.comp === competenciaAtual() ? hoje.getDate() : 0;
  const classe = (d) => [fds(d) ? 'fds' : '', d === diaHoje ? 'hoje' : ''].join(' ').trim();

  $('#pl-info').textContent = plLinhas.length ? `${plLinhas.length} linha(s)${busca ? ` · ${visiveis.length} no filtro` : ''}` : '';
  $('#pl-legenda').hidden = !plLinhas.length;
  const wrap = $('#pl-wrap');
  if (!plLinhas.length) {
    wrap.className = 'cartao';
    wrap.innerHTML = vazio({
      ilustra: 'calendario',
      titulo: `A planilha de ${nomeCompetencia(estado.comp)} ainda está vazia`,
      texto: 'Adicione as duplas paciente + profissional atendidas no mês, ou aproveite as do mês anterior com um clique.',
      acoes: `<button class="btn" onclick="$('#pl-adicionar').click()">${ic('mais')} Adicionar linha</button>
        <button class="btn sec" onclick="$('#pl-copiar').click()">${ic('copiar')} Copiar do mês anterior</button>`,
    });
    return;
  }
  wrap.className = 'planilha-wrap';

  const cabDias = Array.from({ length: n }, (_, i) => {
    const d = i + 1;
    return `<th class="${classe(d)}" ${d === diaHoje ? 'title="Hoje"' : ''}>${d}<small>${DIAS_SEMANA[diaDaSemana(estado.comp, d)]}</small></th>`;
  }).join('');

  const corpo = visiveis.map((l) => {
    const dias = Array.from({ length: n }, (_, i) => {
      const d = i + 1, v = l.dias[d] || '';
      return `<td class="${classe(d)}"><input class="dia ${classeDia(v)}" data-id="${l.id}" data-dia="${d}" value="${esc(v)}" maxlength="4" aria-label="Dia ${d}"></td>`;
    }).join('');
    const folha = l.folha_origem
      ? `<span class="tag ok" title="${esc(l.folha_arquivo || 'Marcada manualmente')}">${ic('check')}</span>`
      : '<span class="tag neutra" title="Folha ainda não recebida">—</span>';
    return `<tr data-id="${l.id}">
      <td class="fixa c1" title="${esc(l.paciente)}">${pessoa(l.paciente)}</td>
      <td class="fixa c2" title="${esc(l.profissional)}">${pessoa(l.profissional, l.categoria || '')}</td>
      ${dias}
      <td class="total" data-total="${l.id}">${fmtNum(totalLinha(l))}</td>
      <td class="folha">${folha}</td>
      <td class="acoes"><button class="btn fantasma peq icone" data-remover="${l.id}" title="Remover linha">${ic('lixo')}</button></td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="planilha">
    <thead><tr><th class="fixa c1">Paciente</th><th class="fixa c2">Profissional</th>${cabDias}<th>Total</th><th>Folha</th><th></th></tr></thead>
    <tbody>${corpo}</tbody>
    <tfoot><tr><td class="fixa c1">Total do dia</td><td class="fixa c2"></td>
      ${Array.from({ length: n }, (_, i) => `<td data-total-dia="${i + 1}"></td>`).join('')}<td data-total-geral></td><td></td><td></td></tr></tfoot>
  </table>`;
  atualizarTotaisDia(visiveis);
}

function fmtNum(n) { return n ? n.toLocaleString('pt-BR') : ''; }

function atualizarTotaisDia(visiveis = plLinhas) {
  const n = diasDoMes(estado.comp);
  let geral = 0;
  for (let d = 1; d <= n; d++) {
    const t = visiveis.reduce((s, l) => s + valorDia(l.dias[d]), 0);
    geral += t;
    const td = $(`[data-total-dia="${d}"]`);
    if (td) td.textContent = fmtNum(t);
  }
  const g = $('[data-total-geral]');
  if (g) g.textContent = fmtNum(geral);
}

$('#pl-busca').addEventListener('input', renderPlanilha);

$('#pl-wrap').addEventListener('input', (e) => {
  const inp = e.target.closest('input.dia');
  if (!inp) return;
  const l = plLinhas.find((x) => x.id === Number(inp.dataset.id));
  const v = inp.value.trim().toUpperCase();
  if (v) l.dias[inp.dataset.dia] = v; else delete l.dias[inp.dataset.dia];
  inp.className = `dia ${classeDia(v)}`;
  $(`[data-total="${l.id}"]`).textContent = fmtNum(totalLinha(l));
  atualizarTotaisDia();
  salvarLinha(l);
});

function salvarLinha(l) {
  clearTimeout(plTimers.get(l.id));
  plTimers.set(l.id, setTimeout(async () => {
    plTimers.delete(l.id);
    try { await api(`/api/atendimentos/${l.id}`, { method: 'PUT', body: { dias: l.dias } }); }
    catch (e) { toast(`Não foi possível salvar (${l.paciente}): ${e.message}`, true); }
  }, 500));
}
// Garante o envio do que estiver pendente ao sair da página.
window.addEventListener('beforeunload', (e) => { if (plTimers.size) { e.preventDefault(); } });

// Navegação por teclado entre as células
$('#pl-wrap').addEventListener('keydown', (e) => {
  const inp = e.target.closest('input.dia');
  if (!inp) return;
  const mapa = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0], Enter: [1, 0] };
  const mov = mapa[e.key];
  if (!mov) return;
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && inp.value && inp.selectionStart !== (e.key === 'ArrowLeft' ? 0 : inp.value.length)) return;
  e.preventDefault();
  const linhas = $$('#pl-wrap tbody tr');
  const r = linhas.indexOf(inp.closest('tr')) + mov[0];
  const d = Number(inp.dataset.dia) + mov[1];
  const alvo = linhas[r] && $(`input[data-dia="${d}"]`, linhas[r]);
  if (alvo) { alvo.focus(); alvo.select(); }
});
$('#pl-wrap').addEventListener('focusin', (e) => { if (e.target.matches('input.dia')) e.target.select(); });

$('#pl-wrap').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-remover]');
  if (!b) return;
  const l = plLinhas.find((x) => x.id === Number(b.dataset.remover));
  if (!await confirmar(`Remover a linha de ${l.paciente} / ${l.profissional} da planilha de ${nomeCompetencia(estado.comp)}? Os dias lançados nessa linha serão perdidos.`, { botao: 'Remover', perigo: true })) return;
  try {
    await api(`/api/atendimentos/${l.id}`, { method: 'DELETE' });
    plLinhas = plLinhas.filter((x) => x !== l);
    renderPlanilha();
  } catch (err) { toast(err.message, true); }
});

$('#pl-adicionar').addEventListener('click', () => {
  const ativos = (lista) => lista.filter((x) => x.ativo);
  const opcoes = (lista) => ativos(lista).map((x) => `<option value="${esc(x.nome)}">`).join('');
  const m = modal(`<h2>Adicionar linha · ${esc(nomeCompetencia(estado.comp))}</h2>
    <form id="f-linha" class="grade-form">
      <div class="inteiro"><label class="rotulo">Paciente</label><input type="text" name="paciente" list="dl-pac" required autocomplete="off" placeholder="Digite para buscar…"></div>
      <div class="inteiro"><label class="rotulo">Profissional(is) <small>— um por linha para lançar vários de uma vez</small></label>
        <textarea name="profissionais" required style="min-height:4.5em" placeholder="Digite o nome; use a lista abaixo para buscar"></textarea>
        <input type="text" list="dl-pro" id="busca-pro" placeholder="Buscar profissional e pressionar Enter para incluir…" style="margin-top:.4em" autocomplete="off">
      </div>
      <datalist id="dl-pac">${opcoes(estado.pacientes)}</datalist>
      <datalist id="dl-pro">${opcoes(estado.profissionais)}</datalist>
      <p class="suave inteiro" style="margin:0">Não achou o nome? Cadastre antes em <a href="#pacientes" data-fechar>Pacientes</a> ou <a href="#profissionais" data-fechar>Profissionais</a>.</p>
    </form>
    <div class="rodape-modal"><button class="btn sec" data-fechar>Fechar</button><button class="btn" form="f-linha">Adicionar</button></div>`);
  const f = $('#f-linha', m.el);
  const buscaPro = $('#busca-pro', m.el);
  const incluir = () => {
    const v = buscaPro.value.trim();
    if (!v) return;
    f.profissionais.value = [...f.profissionais.value.split('\n').filter((x) => x.trim()), v].join('\n');
    buscaPro.value = '';
  };
  buscaPro.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); incluir(); } });
  buscaPro.addEventListener('change', () => { if (estado.profissionais.some((p) => p.nome === buscaPro.value)) incluir(); });

  const achar = (lista, nome) => lista.find((x) => Conferencia.normalizar(x.nome) === Conferencia.normalizar(nome));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pac = achar(estado.pacientes, f.paciente.value);
    if (!pac) return toast(`Paciente "${f.paciente.value}" não está cadastrado.`, true);
    const nomes = f.profissionais.value.split('\n').map((x) => x.trim()).filter(Boolean);
    const naoAchados = nomes.filter((n) => !achar(estado.profissionais, n));
    if (naoAchados.length) return toast(`Profissional não cadastrado: ${naoAchados.join(', ')}`, true);
    let ok = 0;
    for (const nome of nomes) {
      try {
        await api('/api/atendimentos', { method: 'POST', body: { competencia: estado.comp, paciente_id: pac.id, profissional_id: achar(estado.profissionais, nome).id } });
        ok++;
      } catch (err) { toast(`${nome}: ${err.message}`, true); }
    }
    if (ok) toast(`${ok} linha(s) adicionada(s).`);
    f.reset();
    f.paciente.focus();
    await carregarPlanilha();
  });
});

$('#pl-copiar').addEventListener('click', async () => {
  const de = competenciaAnterior(estado.comp);
  if (!await confirmar(`Copiar as duplas paciente + profissional de ${nomeCompetencia(de)} para ${nomeCompetencia(estado.comp)}? Os dias não são copiados e linhas já existentes são mantidas.`, { botao: 'Copiar' })) return;
  try {
    const r = await api('/api/atendimentos/copiar', { method: 'POST', body: { de, para: estado.comp } });
    toast(r.copiadas ? `${r.copiadas} linha(s) copiada(s).` : `Nada para copiar de ${nomeCompetencia(de)}.`);
    await carregarPlanilha();
  } catch (e) { toast(e.message, true); }
});

function dadosPlanilhaExport() {
  const n = diasDoMes(estado.comp);
  const dias = Array.from({ length: n }, (_, i) => i + 1);
  const linhas = plLinhas.map((l) => [l.paciente, l.profissional, ...dias.map((d) => l.dias[d] || ''), totalLinha(l)]);
  const totais = ['Total do dia', '', ...dias.map((d) => plLinhas.reduce((s, l) => s + valorDia(l.dias[d]), 0) || ''), plLinhas.reduce((s, l) => s + totalLinha(l), 0)];
  return { dias, linhas, totais };
}

$('#pl-xlsx').addEventListener('click', () => {
  if (!plLinhas.length) return toast('A planilha está vazia.', true);
  const { dias, linhas, totais } = dadosPlanilhaExport();
  exportarXlsx(`${nomeArquivoComp('Planilha de atendimento')}.xlsx`, {
    aba: 'Atendimentos',
    cabecalho: [tituloEmpresa(), `Planilha de atendimento · ${nomeCompetencia(estado.comp)}`],
    colunas: [{ titulo: 'Paciente', largura: 34 }, { titulo: 'Profissional', largura: 34 }, ...dias.map((d) => ({ titulo: String(d), largura: 4 })), { titulo: 'Total', largura: 7 }],
    linhas: [...linhas.map((l) => l.map((v, i) => (i >= 2 && /^\d+([.,]\d+)?$/.test(v) ? Number(String(v).replace(',', '.')) : v))), totais],
  });
});

$('#pl-pdf').addEventListener('click', () => {
  if (!plLinhas.length) return toast('A planilha está vazia.', true);
  const { dias, linhas, totais } = dadosPlanilhaExport();
  const fds = (d) => [0, 6].includes(diaDaSemana(estado.comp, d));
  abrirPdf('/api/pdf/tabela', {
    titulo: `Planilha de atendimento · ${nomeCompetencia(estado.comp)}`,
    subtitulo: `${plLinhas.length} linha(s) · ${totais.at(-1).toLocaleString('pt-BR')} atendimento(s). Legenda: número = quantidade de atendimentos; X = 1; F = falta.`,
    orientacao: 'paisagem',
    tamanhoFonte: 6.5,
    colunas: [{ titulo: 'Paciente' }, { titulo: 'Profissional' },
      ...dias.map((d) => ({ titulo: String(d), largura: 15.5, alinhar: 'centro', destaque: fds(d) })), { titulo: 'Total', largura: 26, alinhar: 'centro' }],
    linhas: [...linhas, { celulas: totais.map(String), negrito: true }],
    assinaturas: ['Responsável pelo fechamento', 'Conferido por'],
  }, `${nomeArquivoComp('Planilha de atendimento')}.pdf`);
});

// ================= CONFERÊNCIA DE FOLHAS =================
let cfResultado = null;
let cfFiltro = 'todos';
const STATUS = {
  ok: ['ok', 'Correto', 'check'],
  grafia: ['aviso', 'Grafia diferente', 'editar'],
  fora_padrao: ['aviso', 'Fora do padrão', 'alerta'],
  nao_cadastrado: ['erro', 'Não cadastrado', 'usuario'],
  sem_planilha: ['azul', 'Fora da planilha', 'tabela'],
  duplicado: ['erro', 'Duplicado', 'copiar'],
};

async function carregarConferencia() {
  const { folhas, ultima } = await api(`/api/folhas?competencia=${estado.comp}`);
  $('#cf-ultima').innerHTML = ic('relogio') + esc(ultima
    ? `Última conferência de ${nomeCompetencia(estado.comp)}: ${dataBR(ultima.criado_em)} por ${ultima.usuario} — ${ultima.total_arquivos} arquivo(s), ${ultima.faltando} faltando.`
    : `Nenhuma conferência registrada para ${nomeCompetencia(estado.comp)} ainda.`);
  $('#cf-resultado').hidden = !cfResultado;
  if (cfResultado) renderResultado();
  await renderRegistro(folhas);
}

async function renderRegistro(folhas) {
  if (!folhas) folhas = (await api(`/api/folhas?competencia=${estado.comp}`)).folhas;
  const linhas = await api(`/api/atendimentos?competencia=${estado.comp}`);
  if (!linhas.length) {
    $('#cf-registro').innerHTML = vazio({ ilustra: 'calendario', titulo: 'Nenhuma folha esperada neste mês',
      texto: `A planilha de atendimento de ${esc(nomeCompetencia(estado.comp))} está vazia — é ela que diz quais folhas são esperadas.`,
      acoes: `<a class="btn" href="#planilha">${ic('calendario')} Montar planilha</a>` });
    return;
  }
  const recebida = (l) => folhas.find((f) => f.paciente_id === l.paciente_id && f.profissional_id === l.profissional_id);
  const ordenadas = [...linhas].sort((a, b) => Boolean(recebida(a)) - Boolean(recebida(b)));
  const nRec = linhas.filter(recebida).length;
  $('#cf-registro').innerHTML = `
    <div class="linha" style="margin-bottom:1em"><div class="barra cresce"><span style="width:${(nRec / linhas.length) * 100}%"></span></div>
      <span><b>${nRec}</b> de <b>${linhas.length}</b> folhas recebidas</span></div>
    <div class="tabela-wrap"><table class="t"><thead><tr><th>Paciente</th><th>Profissional</th><th>Situação</th><th>Arquivo</th><th></th></tr></thead><tbody>
    ${ordenadas.map((l) => {
      const f = recebida(l);
      const sit = f ? `<span class="tag ok">${ic('check')} Recebida${f.origem === 'manual' ? ' (manual)' : ''}</span>` : `<span class="tag erro">${ic('docX')} Faltando</span>`;
      return `<tr><td>${pessoa(l.paciente)}</td><td>${pessoa(l.profissional, l.categoria || '')}</td><td>${sit}</td>
        <td class="nome-arq">${esc(f?.arquivo || '')}</td>
        <td class="acoes">${f ? (f.origem === 'manual' ? `<button class="btn fantasma peq" data-marcar="0" data-p="${l.paciente_id}" data-r="${l.profissional_id}">${ic('x')} Desmarcar</button>` : '')
          : `<button class="btn sec peq" data-copiar="${esc(Conferencia.nomeCorreto(l.paciente, l.profissional, ''))}">${ic('copiar')} Copiar nome</button>
             <button class="btn sec peq" data-marcar="1" data-p="${l.paciente_id}" data-r="${l.profissional_id}">${ic('check')} Marcar recebida</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

async function marcarFolha(b) {
  try {
    await api('/api/folhas/marcar', { method: 'POST', body: { competencia: estado.comp, paciente_id: Number(b.dataset.p), profissional_id: Number(b.dataset.r), recebida: b.dataset.marcar === '1' } });
    await renderRegistro();
    atualizarContadorRemoto();
  } catch (e) { toast(e.message, true); }
}

async function copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); toast('Nome copiado: ' + t); }
  catch { prompt('Copie o nome:', t); }
}

document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copiar]');
  if (c) return copiarTexto(c.dataset.copiar);
  const m = e.target.closest('[data-marcar]');
  if (m) marcarFolha(m);
});

// Entrada dos arquivos
$('#cf-pasta').addEventListener('change', (e) => analisarArquivos([...e.target.files].map((f) => f.name), e.target));
$('#cf-arquivos').addEventListener('change', (e) => analisarArquivos([...e.target.files].map((f) => f.name), e.target));
$('#cf-colar').addEventListener('click', () => {
  const m = modal(`<h2>Colar lista de nomes de arquivos</h2>
    <p class="suave">Um nome por linha (ex.: copie da pasta do Windows com <i>Ctrl+Shift+C → Copiar como caminho</i> ou do <code>dir /b</code>).</p>
    <textarea id="cf-lista" style="min-height:14em"></textarea>
    <div class="rodape-modal"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="cf-lista-ok">Conferir</button></div>`);
  $('#cf-lista-ok', m.el).addEventListener('click', () => {
    const nomes = $('#cf-lista', m.el).value.split(/\r?\n/).map((l) => l.trim().replace(/^"|"$/g, '').split(/[\\/]/).pop()).filter(Boolean);
    m.fechar();
    analisarArquivos(nomes);
  });
});

const zona = $('#cf-soltar');
['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('sobre'); }));
['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, () => zona.classList.remove('sobre')));
zona.addEventListener('drop', async (e) => {
  e.preventDefault();
  const entradas = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const nomes = [];
  const ler = (entrada) => new Promise((resolve) => {
    if (entrada.isFile) { nomes.push(entrada.name); return resolve(); }
    const leitor = entrada.createReader();
    const lote = () => leitor.readEntries(async (itens) => {
      if (!itens.length) return resolve();
      for (const i of itens) await ler(i);
      lote();
    }, resolve);
    lote();
  });
  if (entradas.length) for (const en of entradas) await ler(en);
  else nomes.push(...[...e.dataTransfer.files].map((f) => f.name));
  analisarArquivos(nomes);
});

async function analisarArquivos(nomes, input) {
  if (input) input.value = '';
  if (!nomes.length) return toast('Nenhum arquivo encontrado.', true);
  try {
    await carregarCadastros();
    const linhas = await api(`/api/atendimentos?competencia=${estado.comp}`);
    cfResultado = Conferencia.conferir({
      arquivos: nomes,
      pacientes: estado.pacientes,
      profissionais: estado.profissionais,
      esperados: linhas.map((l) => ({ paciente_id: l.paciente_id, profissional_id: l.profissional_id })),
    });
    cfFiltro = cfResultado.resumo.pendencias ? 'pendencias' : 'todos';
    $('#cf-resultado').hidden = false;
    renderResultado();

    // Registra no sistema (substitui a conferência anterior desta competência; marcações manuais ficam).
    const anterior = (await api(`/api/folhas?competencia=${estado.comp}`)).folhas.filter((f) => f.origem === 'pasta').length;
    if (!cfResultado.encontradas.length && anterior &&
        !await confirmar(`Nenhuma folha reconhecida nesta pasta, mas a conferência anterior tinha ${anterior}. Registrar mesmo assim (as folhas da conferência anterior deixam de contar)?`, { botao: 'Registrar', perigo: true })) return;
    await api('/api/folhas/conferencia', { method: 'POST', body: { competencia: estado.comp, encontradas: cfResultado.encontradas, resumo: cfResultado.resumo } });
    toast(`Conferência registrada: ${cfResultado.encontradas.length} folha(s) reconhecida(s).`);
    await carregarConferencia();
    atualizarContadorRemoto();
    $('#cf-resultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast(e.message, true); }
}

function renderResultado() {
  const r = cfResultado.resumo;
  $('#cf-kpis').innerHTML = [
    kpi({ rot: 'Arquivos na pasta', val: r.total, icone: 'arquivos', cor: 'azul' }),
    kpi({ rot: 'Nomes corretos', val: r.ok, icone: 'check' }),
    kpi({ rot: 'Pendência no nome', val: r.pendencias, icone: 'editar', cor: 'ambar', det: r.pendencias ? 'veja as sugestões abaixo' : 'nenhuma' }),
    kpi({ rot: 'Faltando subir', val: `${r.faltando}<small> / ${r.esperados}</small>`, icone: 'docX', cor: 'coral', det: 'folhas esperadas na planilha' }),
  ].join('');

  $('#cf-faltando').innerHTML = !r.esperados
    ? vazio({ ilustra: 'calendario', titulo: 'Nenhuma folha esperada', texto: `A planilha de ${esc(nomeCompetencia(estado.comp))} está vazia.`, acoes: `<a class="btn" href="#planilha">${ic('calendario')} Montar planilha</a>` })
    : !cfResultado.faltando.length ? vazio({ ilustra: 'pasta', titulo: 'Nenhuma folha faltando!', texto: 'Todas as folhas da planilha estão na pasta.' })
      : `<div class="tabela-wrap"><table class="t"><thead><tr><th>Paciente</th><th>Profissional</th><th>Nome esperado do arquivo</th><th></th></tr></thead><tbody>
        ${cfResultado.faltando.map((f) => `<tr><td>${pessoa(f.paciente)}</td><td>${pessoa(f.profissional)}</td><td class="nome-arq">${esc(f.nomeArquivo)}</td>
          <td class="acoes"><button class="btn sec peq" data-copiar="${esc(f.nomeArquivo.replace(/\.pdf$/, ''))}">${ic('copiar')} Copiar nome</button></td></tr>`).join('')}
      </tbody></table></div>`;

  const filtros = [['todos', 'Todos', r.total], ['pendencias', 'Com pendência', r.pendencias], ['ok', 'Corretos', r.ok],
    ...Object.entries(STATUS).filter(([k]) => k !== 'ok' && r[k]).map(([k, [, rot]]) => [k, rot, r[k]])];
  $('#cf-filtros').innerHTML = filtros.map(([k, rot, n]) => `<button data-filtro="${k}" class="${cfFiltro === k ? 'ativo' : ''}">${esc(rot)} (${n})</button>`).join('');
  $$('#cf-filtros button').forEach((b) => b.addEventListener('click', () => { cfFiltro = b.dataset.filtro; renderResultado(); }));

  const itens = cfResultado.itens.filter((i) => cfFiltro === 'todos' || (cfFiltro === 'pendencias' ? i.status !== 'ok' : i.status === cfFiltro));
  $('#cf-itens').innerHTML = itens.length ? itens.map((i) => {
    const [cls, rot, icone] = STATUS[i.status];
    return `<tr>
      <td class="nome-arq" style="max-width:340px">${esc(i.arquivo)}</td>
      <td style="max-width:300px"><span class="tag ${cls}">${ic(icone)} ${rot}</span>${i.mensagem ? `<br><small>${esc(i.mensagem)}</small>` : ''}</td>
      <td>${i.paciente ? pessoa(i.paciente.nome, i.profissional.nome) : '<small>—</small>'}</td>
      <td style="max-width:340px">${i.sugestao ? `<span class="nome-arq sugestao">${esc(i.sugestao)}</span><br><button class="btn sec peq" style="margin-top:.4em" data-copiar="${esc(i.sugestao.replace(/\.[^.]+$/, ''))}">${ic('copiar')} Copiar</button>` : ''}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="vazio">Nenhum arquivo neste filtro.</td></tr>';
}

$('#cf-bat').addEventListener('click', () => {
  const s = Conferencia.scriptRenomear(cfResultado.itens);
  if (!s.quantidade) return toast('Nenhum arquivo com nome a corrigir.');
  baixarBlob(new Blob([s.texto], { type: 'application/x-bat' }), `renomear-folhas-${estado.comp}.bat`);
  toast(`Script gerado para ${s.quantidade} arquivo(s). Copie-o para a pasta das folhas e dê dois cliques.`);
});

$('#cf-xlsx').addEventListener('click', () => {
  exportarXlsx(`${nomeArquivoComp('Conferência de folhas')}.xlsx`, {
    aba: 'Conferência',
    cabecalho: [tituloEmpresa(), `Conferência de folhas · ${nomeCompetencia(estado.comp)}`],
    colunas: [{ titulo: 'Arquivo', largura: 60 }, { titulo: 'Situação', largura: 18 }, { titulo: 'Detalhe', largura: 50 }, { titulo: 'Paciente', largura: 32 }, { titulo: 'Profissional', largura: 32 }, { titulo: 'Nome sugerido', largura: 60 }],
    linhas: cfResultado.itens.map((i) => [i.arquivo, STATUS[i.status][1], i.mensagem, i.paciente?.nome || '', i.profissional?.nome || '', i.sugestao || '']),
  });
});
$('#cf-pdf').addEventListener('click', () => {
  abrirPdf('/api/pdf/tabela', {
    titulo: `Conferência de folhas · ${nomeCompetencia(estado.comp)}`,
    subtitulo: `${cfResultado.resumo.total} arquivo(s) · ${cfResultado.resumo.ok} correto(s) · ${cfResultado.resumo.pendencias} com pendência · ${cfResultado.resumo.faltando} faltando`,
    orientacao: 'paisagem',
    colunas: [{ titulo: 'Arquivo' }, { titulo: 'Situação', largura: 80 }, { titulo: 'Paciente' }, { titulo: 'Profissional' }, { titulo: 'Nome sugerido' }],
    linhas: cfResultado.itens.map((i) => [i.arquivo, STATUS[i.status][1], i.paciente?.nome || '', i.profissional?.nome || '', i.sugestao || '']),
  }, `${nomeArquivoComp('Conferência de folhas')}.pdf`);
});
$('#cf-falt-xlsx').addEventListener('click', () => {
  exportarXlsx(`${nomeArquivoComp('Folhas faltando')}.xlsx`, {
    aba: 'Faltando',
    cabecalho: [tituloEmpresa(), `Folhas faltando · ${nomeCompetencia(estado.comp)}`],
    colunas: [{ titulo: 'Paciente', largura: 36 }, { titulo: 'Profissional', largura: 36 }, { titulo: 'Nome esperado do arquivo', largura: 80 }],
    linhas: cfResultado.faltando.map((f) => [f.paciente, f.profissional, f.nomeArquivo]),
  });
});
$('#cf-falt-pdf').addEventListener('click', () => {
  abrirPdf('/api/pdf/tabela', {
    titulo: `Folhas faltando · ${nomeCompetencia(estado.comp)}`,
    subtitulo: `${cfResultado.faltando.length} de ${cfResultado.resumo.esperados} folha(s) esperada(s) ainda não foram recebidas.`,
    colunas: [{ titulo: '#', largura: 26, alinhar: 'centro' }, { titulo: 'Paciente' }, { titulo: 'Profissional' }],
    linhas: cfResultado.faltando.map((f, i) => [String(i + 1), f.paciente, f.profissional]),
  }, `${nomeArquivoComp('Folhas faltando')}.pdf`);
});

// ================= CADASTROS =================
const CADASTRO = {
  pacientes: {
    titulo: 'Pacientes', singular: 'paciente', icone: 'coracao',
    descricao: 'Quem recebe o atendimento domiciliar. O nome cadastrado aqui é o que deve aparecer no arquivo da folha.',
    campos: [
      { k: 'nome', rot: 'Nome completo', obrig: true, inteiro: true },
      { k: 'cpf', rot: 'CPF' },
      { k: 'nascimento', rot: 'Data de nascimento', tipo: 'date' },
      { k: 'telefone', rot: 'Telefone' },
      { k: 'responsavel', rot: 'Responsável / familiar' },
      { k: 'convenio', rot: 'Convênio / operadora' },
      { k: 'endereco', rot: 'Endereço', inteiro: true },
      { k: 'observacoes', rot: 'Observações', inteiro: true, area: true },
    ],
    colunas: ['nome', 'cpf', 'telefone', 'nascimento'],
    // Nomes de coluna aceitos na importação do Excel
    modelo: {
      colunas: ['NOME', 'CPF', 'DATA DE NASCIMENTO', 'TELEFONE', 'RESPONSÁVEL', 'CONVÊNIO', 'ENDEREÇO', 'OBSERVAÇÕES'],
      exemplos: [['Maria da Silva Souza', '123.456.789-09', '03/05/1945', '(11) 99999-0000', 'Ana Souza (filha)', 'Unimed', 'Rua das Flores, 100 - Centro', ''],
        ['José Carlos Pereira', '', '', '', '', 'Particular', '', '']],
    },
    sinonimos: { nome: ['nome', 'nome_completo', 'paciente', 'nome_do_paciente', 'nome_paciente'], cpf: ['cpf'], nascimento: ['nascimento', 'data_de_nascimento', 'data_nascimento', 'dt_nascimento'], telefone: ['telefone', 'celular', 'contato', 'fone'], responsavel: ['responsavel', 'familiar'], convenio: ['convenio', 'operadora', 'plano'], endereco: ['endereco', 'endereco_completo'], observacoes: ['observacoes', 'observacao', 'obs'] },
  },
  profissionais: {
    titulo: 'Profissionais', singular: 'profissional', icone: 'estetoscopio',
    descricao: 'Prestadores que realizam os atendimentos: técnicos, enfermeiros, cuidadores, fisioterapeutas e outros.',
    campos: [
      { k: 'nome', rot: 'Nome completo', obrig: true, inteiro: true },
      { k: 'categoria', rot: 'Categoria / função', lista: true },
      { k: 'registro', rot: 'Registro (COREN, CREFITO…)' },
      { k: 'cpf', rot: 'CPF' },
      { k: 'telefone', rot: 'Telefone' },
      { k: 'email', rot: 'E-mail', tipo: 'email' },
      { k: 'chave_pix', rot: 'Chave PIX / dados bancários' },
      { k: 'observacoes', rot: 'Observações', inteiro: true, area: true },
    ],
    colunas: ['nome', 'categoria', 'registro', 'telefone'],
    modelo: {
      colunas: ['NOME', 'CATEGORIA', 'REGISTRO', 'CPF', 'TELEFONE', 'E-MAIL', 'CHAVE PIX', 'OBSERVAÇÕES'],
      exemplos: [['Ana Paula Rodrigues', 'Técnico(a) de enfermagem', 'COREN-SP 123456', '987.654.321-00', '(11) 98888-0000', 'ana@email.com', 'ana@email.com', ''],
        ['Carlos Eduardo Santos', 'Fisioterapeuta', '', '', '', '', '', '']],
    },
    sinonimos: { nome: ['nome', 'nome_completo', 'profissional', 'prestador', 'nome_do_profissional', 'nome_profissional'], categoria: ['categoria', 'funcao', 'cargo', 'especialidade', 'profissao'], registro: ['registro', 'coren', 'crefito', 'conselho', 'registro_profissional'], cpf: ['cpf'], telefone: ['telefone', 'celular', 'contato', 'fone'], email: ['email', 'e_mail'], chave_pix: ['chave_pix', 'pix', 'dados_bancarios', 'banco'], observacoes: ['observacoes', 'observacao', 'obs'] },
  },
};
let plLinhasMes = [];
const filtroCad = { pacientes: { q: '', inativos: false }, profissionais: { q: '', inativos: false } };

function renderCadastro(tipo) {
  const def = CADASTRO[tipo];
  const sec = $(`#sec-${tipo}`);
  if (!sec.dataset.montado) {
    sec.dataset.montado = '1';
    sec.innerHTML = `
      <div class="hero">
        <img class="deco" src="img/favicon.svg" alt="">
        <div>
          <span class="selo">${ic(def.icone)} Cadastros</span>
          <h1>${def.titulo}</h1>
          <p>${def.descricao}</p>
        </div>
        <div class="acoes">
          <button class="btn" data-acao="novo">${ic('mais')} Novo ${def.singular}</button>
          <label class="btn sec"><input type="file" accept=".xlsx,.xls,.csv" data-acao="importar" hidden>${ic('enviar')} Importar Excel</label>
          <button class="btn fantasma" data-acao="modelo" title="Planilha com as colunas aceitas na importação">${ic('baixar')} Baixar modelo</button>
        </div>
      </div>
      <div class="cards" data-kpis></div>
      <div class="barra-ferr">
        <div class="busca cresce" style="max-width:420px">${ic('busca')}<input type="search" data-acao="busca" placeholder="Buscar ${def.singular} por nome, CPF, telefone…"></div>
        <label class="check"><input type="checkbox" data-acao="inativos"> mostrar inativos</label>
        <span class="cresce"></span>
        <button class="btn sec" data-acao="xlsx">${ic('planilha')} Excel</button>
        <button class="btn sec" data-acao="pdf">${ic('baixar')} PDF timbrado</button>
      </div>
      <div data-tabela></div>`;
    $('[data-acao="novo"]', sec).addEventListener('click', () => editarCadastro(tipo));
    $('[data-acao="busca"]', sec).addEventListener('input', (e) => { filtroCad[tipo].q = e.target.value; desenharTabelaCad(tipo); });
    $('[data-acao="inativos"]', sec).addEventListener('change', (e) => { filtroCad[tipo].inativos = e.target.checked; desenharTabelaCad(tipo); });
    $('[data-acao="importar"]', sec).addEventListener('change', (e) => importarCadastro(tipo, e.target));
    $('[data-acao="xlsx"]', sec).addEventListener('click', () => exportarCad(tipo, 'xlsx'));
    $('[data-acao="modelo"]', sec).addEventListener('click', () => {
      const m = def.modelo;
      exportarXlsx(`Modelo de importação - ${def.titulo}.xlsx`, { aba: def.titulo, colunas: m.colunas.map((t) => ({ titulo: t, largura: t === 'NOME' || t === 'ENDEREÇO' ? 36 : 20 })), linhas: m.exemplos });
    });
    $('[data-acao="pdf"]', sec).addEventListener('click', () => exportarCad(tipo, 'pdf'));
  }
  return Promise.all([carregarCadastros(), api(`/api/atendimentos?competencia=${estado.comp}`).then((r) => { plLinhasMes = r; })])
    .then(() => desenharTabelaCad(tipo));
}

function listaCad(tipo) {
  const q = Conferencia.normalizar(filtroCad[tipo].q);
  return estado[tipo].filter((x) => (filtroCad[tipo].inativos || x.ativo) &&
    (!q || Conferencia.normalizar(Object.values(x).join(' ')).includes(q)));
}

function rotuloCampo(tipo, k) { return CADASTRO[tipo].campos.find((c) => c.k === k)?.rot || k; }
function fmtCampo(k, v) { return k === 'nascimento' && v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : (v || ''); }

function desenharTabelaCad(tipo) {
  const def = CADASTRO[tipo];
  const sec = $(`#sec-${tipo}`);
  const lista = listaCad(tipo);
  const ativos = estado[tipo].filter((x) => x.ativo).length;
  const naPlanilha = new Set(plLinhasMes.map((l) => l[tipo === 'pacientes' ? 'paciente_id' : 'profissional_id'])).size;
  $('[data-kpis]', sec).innerHTML = [
    kpi({ rot: 'Ativos', val: ativos, icone: def.icone, cor: tipo === 'pacientes' ? 'coral' : '' }),
    kpi({ rot: `Na planilha de ${nomeCompetencia(estado.comp).split(' ')[0]}`, val: naPlanilha, icone: 'calendario', cor: 'azul' }),
    kpi({ rot: 'Inativos', val: estado[tipo].length - ativos, icone: 'relogio', cor: 'ambar', det: 'histórico preservado' }),
  ].join('');
  const sub = (x) => (tipo === 'pacientes' ? [x.convenio, x.responsavel && `Resp.: ${x.responsavel}`] : [x.registro]).filter(Boolean).join(' · ');
  $('[data-tabela]', sec).innerHTML = !lista.length
    ? `<div class="cartao">${estado[tipo].length ? vazio({ ilustra: 'pessoas', titulo: 'Nenhum resultado', texto: 'Tente outro termo na busca.' })
      : vazio({ ilustra: 'pessoas', titulo: `Nenhum ${def.singular} cadastrado ainda`, texto: 'Cadastre um por um ou importe direto da sua planilha do Excel.',
          acoes: `<button class="btn" onclick="$('#sec-${tipo} [data-acao=novo]').click()">${ic('mais')} Novo ${def.singular}</button>` })}</div>`
    : `<div class="tabela-wrap"><table class="t"><thead><tr>${def.colunas.map((k) => `<th>${esc(rotuloCampo(tipo, k))}</th>`).join('')}<th>Situação</th><th>Linhas lançadas</th><th></th></tr></thead><tbody>
      ${lista.map((x) => `<tr class="${x.ativo ? '' : 'inativo'}">
        ${def.colunas.map((k, i) => `<td>${i === 0 ? pessoa(x.nome, sub(x)) : k === 'categoria' && x[k] ? `<span class="tag info">${esc(x[k])}</span>` : esc(fmtCampo(k, x[k]))}</td>`).join('')}
        <td>${x.ativo ? '<span class="tag ok">Ativo</span>' : '<span class="tag neutra">Inativo</span>'}</td>
        <td>${x.usos ? `<span class="suave">${x.usos} na planilha</span>` : ''}</td>
        <td class="acoes"><button class="btn sec peq" data-editar="${x.id}">${ic('editar')} Editar</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $$('[data-editar]', sec).forEach((b) => b.addEventListener('click', () => editarCadastro(tipo, estado[tipo].find((x) => x.id === Number(b.dataset.editar)))));
}

function editarCadastro(tipo, item = null) {
  const def = CADASTRO[tipo];
  const categorias = (estado.cfg.categorias || '').split(',').map((c) => c.trim()).filter(Boolean);
  const campos = def.campos.map((c) => {
    const v = esc(item?.[c.k] || '');
    const ctrl = c.area ? `<textarea name="${c.k}">${v}</textarea>`
      : `<input type="${c.tipo || 'text'}" name="${c.k}" value="${v}" ${c.obrig ? 'required' : ''} ${c.lista ? 'list="dl-cat"' : ''}>`;
    return `<div class="${c.inteiro ? 'inteiro' : ''}"><label class="rotulo">${esc(c.rot)}</label>${ctrl}</div>`;
  }).join('');
  const m = modal(`<h2>${item ? 'Editar' : 'Novo'} ${def.singular}</h2>
    <form id="f-cad" class="grade-form">${campos}</form>
    <datalist id="dl-cat">${categorias.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    ${item ? `<p class="suave" style="margin:.8em 0 0">Nome do arquivo para este ${def.singular}: <code>${tipo === 'pacientes' ? 'Paciente' : 'Profissional'} ${esc(item.nome)}</code></p>` : ''}
    <div class="rodape-modal" style="justify-content:space-between">
      <div class="linha">${item ? `<button class="btn perigo" id="b-excluir">${item.usos ? 'Inativar' : 'Excluir'}</button>
        ${item.ativo ? '' : '<button class="btn sec" id="b-reativar">Reativar</button>'}` : ''}</div>
      <div class="linha"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" form="f-cad">Salvar</button></div>
    </div>`);
  $('#f-cad', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = Object.fromEntries(new FormData(e.target));
    try {
      if (item) await api(`/api/${tipo}/${item.id}`, { method: 'PUT', body: dados });
      else await api(`/api/${tipo}`, { method: 'POST', body: dados });
      toast('Salvo.');
      m.fechar();
      renderCadastro(tipo);
    } catch (err) { toast(err.message, true); }
  });
  $('#b-excluir', m.el)?.addEventListener('click', async () => {
    const msg = item.usos ? `${item.nome} aparece em planilhas de atendimento, então será inativado (o histórico é mantido).` : `Excluir ${item.nome}?`;
    if (!await confirmar(msg, { botao: item.usos ? 'Inativar' : 'Excluir', perigo: true })) return;
    try {
      const r = await api(`/api/${tipo}/${item.id}`, { method: 'DELETE' });
      toast(r.inativado ? 'Inativado.' : 'Excluído.');
      m.fechar();
      renderCadastro(tipo);
    } catch (err) { toast(err.message, true); }
  });
  $('#b-reativar', m.el)?.addEventListener('click', async () => {
    await api(`/api/${tipo}/${item.id}`, { method: 'PUT', body: { ativo: true } });
    toast('Reativado.');
    m.fechar();
    renderCadastro(tipo);
  });
}

async function importarCadastro(tipo, input) {
  const arq = input.files[0];
  input.value = '';
  if (!arq) return;
  const def = CADASTRO[tipo];
  try {
    const linhas = await lerPlanilha(arq);
    if (!linhas.length) return toast('Planilha vazia.', true);
    const colunasArq = Object.keys(linhas[0]);
    const mapa = {};
    for (const [campo, nomes] of Object.entries(def.sinonimos)) mapa[campo] = nomes.find((n) => colunasArq.includes(n));
    if (!mapa.nome) return toast(`Não encontrei a coluna NOME na planilha. Colunas lidas: ${colunasArq.join(', ')}`, true);
    const itens = linhas.map((l) => Object.fromEntries(Object.entries(mapa).filter(([, col]) => col).map(([campo, col]) => [campo, normalizarImport(campo, l[col])])))
      .filter((i) => i.nome);
    const reconhecidas = Object.entries(mapa).filter(([, c]) => c).map(([k]) => rotuloCampo(tipo, k));
    const m = modal(`<h2>Importar ${def.titulo.toLowerCase()}</h2>
      <p><b>${itens.length}</b> registro(s) encontrados em <i>${esc(arq.name)}</i>.</p>
      <p class="suave">Colunas reconhecidas: ${esc(reconhecidas.join(', '))}.<br>
      Nomes já cadastrados são atualizados (só os campos preenchidos na planilha); os demais são incluídos.</p>
      <div class="tabela-wrap" style="max-height:40vh"><table class="t"><thead><tr>${Object.keys(mapa).filter((k) => mapa[k]).map((k) => `<th>${esc(rotuloCampo(tipo, k))}</th>`).join('')}</tr></thead>
        <tbody>${itens.slice(0, 50).map((i) => `<tr>${Object.keys(mapa).filter((k) => mapa[k]).map((k) => `<td style="white-space:nowrap">${esc(fmtCampo(k, i[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${itens.length > 50 ? `<p class="suave">… e mais ${itens.length - 50}.</p>` : ''}
      <div class="rodape-modal"><button class="btn sec" data-fechar>Cancelar</button><button class="btn" id="b-imp">Importar</button></div>`);
    $('#b-imp', m.el).addEventListener('click', async () => {
      try {
        const r = await api(`/api/${tipo}/importar`, { method: 'POST', body: { itens } });
        toast(`Importação concluída: ${r.novos} novo(s), ${r.atualizados} atualizado(s).`);
        m.fechar();
        renderCadastro(tipo);
      } catch (err) { toast(err.message, true); }
    });
  } catch (e) { toast(`Não foi possível ler a planilha: ${e.message}`, true); }
}

function normalizarImport(campo, v) {
  v = String(v ?? '').trim();
  if (campo === 'nascimento') {
    const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (br) { const ano = br[3].length === 2 ? (Number(br[3]) > 30 ? '19' : '20') + br[3] : br[3]; return `${ano}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`; }
  }
  if (campo === 'cpf' && /^\d{9,11}$/.test(v)) v = v.padStart(11, '0').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return v;
}

function exportarCad(tipo, formato) {
  const def = CADASTRO[tipo];
  const lista = listaCad(tipo);
  if (formato === 'xlsx') {
    const campos = def.campos.filter((c) => c.k !== 'observacoes');
    return exportarXlsx(`${def.titulo}.xlsx`, {
      aba: def.titulo,
      cabecalho: [tituloEmpresa(), def.titulo],
      colunas: [...campos.map((c) => ({ titulo: c.rot, largura: c.k === 'nome' || c.k === 'endereco' ? 36 : 18 })), { titulo: 'Situação', largura: 10 }],
      linhas: lista.map((x) => [...campos.map((c) => fmtCampo(c.k, x[c.k])), x.ativo ? 'Ativo' : 'Inativo']),
    });
  }
  abrirPdf('/api/pdf/tabela', {
    titulo: def.titulo,
    subtitulo: `${lista.length} registro(s)`,
    colunas: [{ titulo: '#', largura: 24, alinhar: 'centro' }, ...def.colunas.map((k) => ({ titulo: rotuloCampo(tipo, k) }))],
    linhas: lista.map((x, i) => [String(i + 1), ...def.colunas.map((k) => fmtCampo(k, x[k]))]),
  }, `${def.titulo}.pdf`);
}

// ================= DOCUMENTOS =================
let docs = [];
let docAtual = null;

const MODELOS = {
  declaracao: {
    nome: 'Declaração de prestação de serviço',
    titulo: 'Declaração',
    corpo: (c) => `Declaramos, para os devidos fins, que [NOME DO PROFISSIONAL], inscrito(a) no CPF sob o nº [CPF], presta serviços de [FUNÇÃO] à ${c.empresa_nome || 'Hessel Domiciliar'}${c.empresa_cnpj ? `, inscrita no CNPJ sob o nº ${c.empresa_cnpj}` : ''}, em regime de atendimento domiciliar, desde [DATA DE INÍCIO].\n\nPor ser expressão da verdade, firmamos a presente declaração.`,
  },
  comunicado: {
    nome: 'Comunicado aos profissionais',
    titulo: 'Comunicado',
    destinatario: 'Aos profissionais da equipe de atendimento domiciliar',
    corpo: () => `Informamos que as folhas de atendimento referentes ao mês de [MÊS] devem ser enviadas até o dia [DATA], devidamente preenchidas e assinadas.\n\nPedimos que o arquivo seja nomeado no padrão "Paciente NOME DO PACIENTE - Profissional NOME DO PROFISSIONAL", para agilizar a conferência e o fechamento da produtividade.\n\nEm caso de dúvidas, estamos à disposição.`,
  },
  oficio: {
    nome: 'Ofício',
    titulo: 'Ofício nº [Nº]/[ANO]',
    destinatario: 'Ao(À) Sr(a). [NOME]\n[CARGO / INSTITUIÇÃO]',
    corpo: () => `Assunto: [ASSUNTO]\n\nPrezado(a) Senhor(a),\n\n[TEXTO DO OFÍCIO]\n\nAtenciosamente,`,
  },
  recibo: {
    nome: 'Recibo',
    titulo: 'Recibo',
    corpo: (c) => `Recebi da ${c.empresa_nome || 'Hessel Domiciliar'} a importância de R$ [VALOR] ([VALOR POR EXTENSO]), referente aos atendimentos domiciliares prestados no mês de [MÊS/ANO], conforme planilha de atendimento.\n\nPara clareza, firmo o presente recibo.`,
  },
};

async function carregarDocumentos() {
  const sel = $('#doc-modelo');
  if (sel.options.length === 1) sel.insertAdjacentHTML('beforeend', Object.entries(MODELOS).map(([k, m]) => `<option value="${k}">${esc(m.nome)}</option>`).join(''));
  docs = await api('/api/documentos');
  desenharListaDocs();
}

function desenharListaDocs() {
  const q = Conferencia.normalizar($('#doc-busca').value);
  const lista = docs.filter((d) => !q || Conferencia.normalizar(d.titulo + ' ' + (d.destinatario || '')).includes(q));
  $('#doc-lista').innerHTML = lista.length ? lista.map((d) => `<button data-doc="${d.id}" class="${docAtual?.id === d.id ? 'ativo' : ''}">
      <span class="bolha">${ic('documento')}</span><span><b>${esc(d.titulo)}</b><small class="suave">${esc(dataBR(d.atualizado_em))} · ${esc(d.usuario || '')}</small></span></button>`).join('')
    : vazio({ ilustra: 'documento', titulo: 'Nenhum documento salvo', texto: 'Escolha um modelo ao lado para começar.' });
  $$('#doc-lista [data-doc]').forEach((b) => b.addEventListener('click', () => abrirDoc(Number(b.dataset.doc))));
}

async function abrirDoc(id) {
  docAtual = await api(`/api/documentos/${id}`);
  preencherDoc(docAtual);
  desenharListaDocs();
}

function preencherDoc(d) {
  $('#doc-titulo').value = d?.titulo || '';
  $('#doc-dest').value = d?.destinatario || '';
  $('#doc-corpo').value = d?.corpo || '';
  $('#doc-local').value = d?.local_data || '';
  $('#doc-ass').value = d?.assinatura || '';
  $('#doc-excluir').hidden = !d?.id;
  $('#doc-modelo').value = '';
}

const lerFormDoc = () => ({
  titulo: $('#doc-titulo').value, destinatario: $('#doc-dest').value, corpo: $('#doc-corpo').value,
  local_data: $('#doc-local').value, assinatura: $('#doc-ass').value,
});

$('#doc-busca').addEventListener('input', desenharListaDocs);
$('#doc-novo').addEventListener('click', () => { docAtual = null; preencherDoc(null); desenharListaDocs(); $('#doc-titulo').focus(); });
$('#doc-modelo').addEventListener('change', async (e) => {
  const m = MODELOS[e.target.value];
  if (!m) return;
  if ($('#doc-corpo').value.trim() && !await confirmar('Substituir o texto atual pelo modelo?', { botao: 'Substituir' })) { e.target.value = ''; return; }
  $('#doc-titulo').value = m.titulo;
  $('#doc-dest').value = m.destinatario || '';
  $('#doc-corpo').value = m.corpo(estado.cfg);
  if (!$('#doc-ass').value) $('#doc-ass').value = `${estado.eu.nome}\n${estado.cfg.empresa_nome || 'Hessel Domiciliar'}`;
});
$('#doc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    if (docAtual?.id) await api(`/api/documentos/${docAtual.id}`, { method: 'PUT', body: lerFormDoc() });
    else docAtual = { id: (await api('/api/documentos', { method: 'POST', body: lerFormDoc() })).id };
    toast('Documento salvo.');
    $('#doc-excluir').hidden = false;
    docs = await api('/api/documentos');
    desenharListaDocs();
  } catch (err) { toast(err.message, true); }
});
$('#doc-previa').addEventListener('click', () => abrirPdf('/api/pdf/documento', lerFormDoc(), `${$('#doc-titulo').value || 'documento'}.pdf`));
$('#doc-excluir').addEventListener('click', async () => {
  if (!docAtual?.id || !await confirmar(`Excluir o documento "${$('#doc-titulo').value}"?`, { botao: 'Excluir', perigo: true })) return;
  await api(`/api/documentos/${docAtual.id}`, { method: 'DELETE' });
  docAtual = null;
  preencherDoc(null);
  docs = await api('/api/documentos');
  desenharListaDocs();
  toast('Documento excluído.');
});
$('#tb-gerar').addEventListener('click', () => abrirPdf(`/api/pdf/timbrado?orientacao=${$('#tb-orientacao').value}&paginas=${$('#tb-paginas').value}`, undefined, 'Papel timbrado.pdf'));
