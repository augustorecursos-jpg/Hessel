// Conferência das folhas pelo nome do arquivo:
//   "Paciente <nome do paciente> - Profissional <nome do profissional>.pdf"
// Roda no navegador (os arquivos não saem do computador) e também no Node (testes).
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Conferencia = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const CONECTIVOS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  const IGNORAR = /^(\.|~\$|thumbs\.db$|desktop\.ini$)/i;

  /** Minúsculas, sem acentos e espaços simples. */
  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  const tokens = (s) => normalizar(s).split(' ').filter((t) => t && !CONECTIVOS.has(t));

  function separarExtensao(nome) {
    const i = nome.lastIndexOf('.');
    return i > 0 && nome.length - i <= 6 ? [nome.slice(0, i), nome.slice(i)] : [nome, ''];
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    let ant = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const atual = [i];
      for (let j = 1; j <= b.length; j++) {
        atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      ant = atual;
    }
    return ant[b.length];
  }

  /** Nome no padrão exato, com 1 espaço e hífen entre as partes. */
  const PADRAO = /^Paciente (\S.*?) - Profissional (\S.*?)$/;
  /** Variações comuns (Pac., Prof., sem hífen, travessão, underline, dois-pontos, maiúsculas). */
  const PADRAO_SOLTO = /^\s*pac(?:iente)?\b[\s:._-]*(.+?)[\s_]*[-–—_]*[\s_]*\bprof(?:issional)?\b[\s:._-]*(.+?)\s*$/i;

  function analisarNome(nomeArquivo) {
    const [base, ext] = separarExtensao(String(nomeArquivo || '').trim());
    const estrito = base.match(PADRAO);
    if (estrito) return { base, ext, padrao: true, paciente: estrito[1], profissional: estrito[2] };
    const solto = base.match(PADRAO_SOLTO);
    if (solto) return { base, ext, padrao: false, paciente: solto[1], profissional: solto[2] };
    return { base, ext, padrao: false, paciente: null, profissional: null };
  }

  /**
   * Procura o cadastro que corresponde ao texto.
   * exato: mesmo nome ignorando acentos/maiúsculas; senão, sugere o mais parecido (erro de digitação ou nome abreviado).
   */
  function localizar(textoNome, lista) {
    const alvo = normalizar(textoNome);
    if (!alvo) return null;
    const exato = lista.find((c) => c._n === alvo);
    if (exato) return { item: exato, exato: true };

    let melhor = null, melhorNota = 0;
    const tAlvo = tokens(textoNome);
    for (const c of lista) {
      const dist = levenshtein(alvo, c._n);
      let nota = 1 - dist / Math.max(alvo.length, c._n.length);
      // Nome abreviado: todas as palavras digitadas existem no cadastro (ex.: "Maria Souza" → "Maria da Silva Souza")
      if (tAlvo.length >= 2 && tAlvo.every((t) => c._t.includes(t))) nota = Math.max(nota, 0.86);
      if (nota > melhorNota) { melhorNota = nota; melhor = c; }
    }
    return melhorNota >= 0.8 ? { item: melhor, exato: false, nota: melhorNota } : null;
  }

  /** Quando o nome está fora do padrão, tenta achar paciente e profissional citados em qualquer lugar do nome. */
  function procurarDentro(base, lista) {
    const n = ` ${normalizar(base)} `;
    const achados = lista.filter((c) => c._n && n.includes(` ${c._n} `));
    // Prefere o nome mais longo (evita "Ana" ganhar de "Ana Paula")
    achados.sort((x, y) => y._n.length - x._n.length);
    return achados[0] || null;
  }

  const preparar = (lista) => lista.map((c) => ({ ...c, _n: normalizar(c.nome), _t: tokens(c.nome) }));

  function nomeCorreto(paciente, profissional, ext = '.pdf') {
    return `Paciente ${paciente} - Profissional ${profissional}${ext}`;
  }

  /**
   * arquivos: ['nome.pdf', ...]
   * pacientes/profissionais: [{ id, nome }]
   * esperados: [{ paciente_id, profissional_id }] (linhas da planilha de atendimento do mês)
   */
  function conferir({ arquivos, pacientes, profissionais, esperados }) {
    const PAC = preparar(pacientes || []);
    const PRO = preparar(profissionais || []);
    const chave = (p, r) => `${p}|${r}`;
    const esperadosSet = new Set((esperados || []).map((e) => chave(e.paciente_id, e.profissional_id)));
    const vistos = new Map();
    const itens = [];

    for (const arquivo of arquivos || []) {
      if (!arquivo || IGNORAR.test(arquivo)) continue;
      const a = analisarNome(arquivo);
      const item = { arquivo, status: 'ok', mensagem: '', sugestao: null, paciente: null, profissional: null };
      let pac = null, pro = null, exatos = a.padrao;

      if (a.paciente !== null) {
        const lp = localizar(a.paciente, PAC);
        const lr = localizar(a.profissional, PRO);
        pac = lp?.item || null;
        pro = lr?.item || null;
        exatos = exatos && lp?.exato && lr?.exato;
        if (!pac || !pro) {
          item.status = 'nao_cadastrado';
          const faltas = [];
          if (!pac) faltas.push(`paciente "${a.paciente.trim()}"`);
          if (!pro) faltas.push(`profissional "${a.profissional.trim()}"`);
          item.mensagem = `Não encontrado no cadastro: ${faltas.join(' e ')}.`;
        }
      } else {
        pac = procurarDentro(a.base, PAC);
        pro = procurarDentro(a.base, PRO);
        exatos = false;
        if (!pac || !pro) {
          item.status = 'fora_padrao';
          item.mensagem = 'Nome fora do padrão e não foi possível identificar paciente e profissional.';
        }
      }

      if (pac && pro) {
        item.paciente = { id: pac.id, nome: pac.nome };
        item.profissional = { id: pro.id, nome: pro.nome };
        const correto = nomeCorreto(pac.nome, pro.nome, a.ext);
        const k = chave(pac.id, pro.id);
        if (vistos.has(k)) {
          item.status = 'duplicado';
          item.mensagem = `Mesma folha que "${vistos.get(k)}".`;
        } else {
          vistos.set(k, arquivo);
          if (!esperadosSet.has(k)) {
            item.status = 'sem_planilha';
            item.mensagem = 'Paciente e profissional cadastrados, mas essa dupla não está na planilha de atendimento do mês.';
          } else if (!a.padrao) {
            item.status = 'fora_padrao';
            item.mensagem = 'Nome fora do padrão (folha reconhecida).';
          } else if (!exatos || a.base + a.ext !== correto) {
            item.status = 'grafia';
            item.mensagem = 'Folha reconhecida, mas a grafia difere do cadastro (acentos, maiúsculas, abreviação ou espaços).';
          }
          if (a.base + a.ext !== correto) item.sugestao = correto;
        }
      }
      itens.push(item);
    }

    const encontradas = [];
    for (const it of itens) {
      if (it.paciente && it.profissional && it.status !== 'duplicado') {
        encontradas.push({ paciente_id: it.paciente.id, profissional_id: it.profissional.id, arquivo: it.arquivo });
      }
    }
    const recebidosSet = new Set(encontradas.map((e) => chave(e.paciente_id, e.profissional_id)));
    const porId = (lista, id) => lista.find((c) => c.id === id);
    const faltando = (esperados || [])
      .filter((e) => !recebidosSet.has(chave(e.paciente_id, e.profissional_id)))
      .map((e) => {
        const p = porId(PAC, e.paciente_id), r = porId(PRO, e.profissional_id);
        return {
          paciente_id: e.paciente_id, profissional_id: e.profissional_id,
          paciente: p?.nome || '?', profissional: r?.nome || '?',
          nomeArquivo: nomeCorreto(p?.nome || '?', r?.nome || '?'),
        };
      })
      .sort((x, y) => x.paciente.localeCompare(y.paciente, 'pt-BR') || x.profissional.localeCompare(y.profissional, 'pt-BR'));

    const conta = (s) => itens.filter((i) => i.status === s).length;
    return {
      itens,
      encontradas,
      faltando,
      resumo: {
        total: itens.length,
        ok: conta('ok'),
        reconhecidos: encontradas.length,
        pendencias: itens.length - conta('ok'),
        grafia: conta('grafia'),
        fora_padrao: conta('fora_padrao'),
        nao_cadastrado: conta('nao_cadastrado'),
        sem_planilha: conta('sem_planilha'),
        duplicado: conta('duplicado'),
        esperados: (esperados || []).length,
        faltando: faltando.length,
      },
    };
  }

  /** Script .bat (Windows) que renomeia os arquivos para o nome sugerido. Deve ser executado dentro da pasta. */
  function scriptRenomear(itens) {
    const linhas = ['@echo off', 'chcp 65001 >nul', 'echo Renomeando folhas para o padrao "Paciente ... - Profissional ..."', ''];
    let n = 0;
    for (const it of itens) {
      if (!it.sugestao || it.status === 'duplicado' || it.arquivo === it.sugestao) continue;
      const seguro = (s) => s.replace(/["%]/g, '');
      const de = seguro(it.arquivo), para = seguro(it.sugestao);
      // No Windows os nomes não diferenciam maiúsculas: se só muda a caixa, renomeia direto.
      linhas.push(de.toLowerCase() === para.toLowerCase()
        ? `if exist "${de}" ren "${de}" "${para}"`
        : `if exist "${de}" if not exist "${para}" ren "${de}" "${para}"`);
      n++;
    }
    linhas.push('', `echo ${n} arquivo(s) processado(s).`, 'pause');
    return { texto: linhas.join('\r\n'), quantidade: n };
  }

  return { normalizar, analisarNome, conferir, nomeCorreto, scriptRenomear, levenshtein };
});
