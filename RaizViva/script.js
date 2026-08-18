
const Util = (() => {
  function uid(prefixo){ return prefixo + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }
  function hoje(){ return new Date(); }
  function paraChaveData(d){
    // YYYY-MM-DD em horário local (evita bug de fuso do toISOString)
    const ano = d.getFullYear(), mes = String(d.getMonth()+1).padStart(2,'0'), dia = String(d.getDate()).padStart(2,'0');
    return `${ano}-${mes}-${dia}`;
  }
  function chaveHoje(){ return paraChaveData(hoje()); }
  function chaveOntem(){ const d = hoje(); d.setDate(d.getDate()-1); return paraChaveData(d); }
  function diaDaSemana(chaveData){
    // 0=Domingo ... 6=Sábado
    const [a,m,d] = chaveData.split('-').map(Number);
    return new Date(a, m-1, d).getDay();
  }
  function somarDias(chaveData, n){
    const [a,m,d] = chaveData.split('-').map(Number);
    const dt = new Date(a, m-1, d);
    dt.setDate(dt.getDate()+n);
    return paraChaveData(dt);
  }
  function chaveMenorQue(a,b){ return a < b; } // strings YYYY-MM-DD comparam corretamente
  function formatarDataBR(chaveData){
    const [a,m,d] = chaveData.split('-');
    return `${d}/${m}/${a}`;
  }
  function horaAtualHHMM(){
    const d = hoje();
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  return { uid, hoje, paraChaveData, chaveHoje, chaveOntem, diaDaSemana, somarDias, chaveMenorQue, formatarDataBR, horaAtualHHMM, escapeHtml };
})();

/* ---------------------------------------------------------------------
   1. CAMADA DE PERSISTÊNCIA (localStorage)
--------------------------------------------------------------------- */
const DB = (() => {
  const CHAVE_USUARIOS = 'rv_usuarios';
  const CHAVE_SESSAO = 'rv_sessao';
  const chaveDados = (userId) => 'rv_dados_' + userId;

  function lerUsuarios(){ return JSON.parse(localStorage.getItem(CHAVE_USUARIOS) || '[]'); }
  function salvarUsuarios(lista){ localStorage.setItem(CHAVE_USUARIOS, JSON.stringify(lista)); }

  function lerSessao(){ return localStorage.getItem(CHAVE_SESSAO); }
  function salvarSessao(userId){ localStorage.setItem(CHAVE_SESSAO, userId); }
  function limparSessao(){ localStorage.removeItem(CHAVE_SESSAO); }

  function lerDados(userId){ return JSON.parse(localStorage.getItem(chaveDados(userId))); }
  function salvarDados(userId, dados){ localStorage.setItem(chaveDados(userId), JSON.stringify(dados)); }

  function dadosIniciais(){
    return {
      habitos: [],
      checkins: [],           // {id, habitoId, data:'YYYY-MM-DD', timestamp, retroativo:bool}
      eventos: [],             // {id, data, texto, tipo:'positivo'|'negativo'}
      estado: {
        xp: 0,
        estagioPlanta: 0,          // índice em NarrativeModule.ESTAGIOS
        falhasConsecutivas: 0,     // dias seguidos com falha total
        ultimaDataAvaliada: Util.somarDias(Util.chaveHoje(), -1) // evita reavaliar o dia da criação da conta
      },
      config: { notificacoesGlobais: true }
    };
  }

  return { lerUsuarios, salvarUsuarios, lerSessao, salvarSessao, limparSessao, lerDados, salvarDados, dadosIniciais };
})();

/* ---------------------------------------------------------------------
   2. MÓDULO 1 — CADASTRO DE USUÁRIO E HÁBITOS (autenticação)
--------------------------------------------------------------------- */
const AuthModule = (() => {
  function hashSenha(s){ return btoa(unescape(encodeURIComponent(s))); } // hash simples só para o protótipo (RNF07 não exigido à risca no MVP)

  function cadastrar(nome, email, senha){
    const usuarios = DB.lerUsuarios();
    if (usuarios.some(u => u.email.toLowerCase() === email.toLowerCase())){
      return { ok:false, erro:'Já existe uma conta com este e-mail.' };
    }
    const novo = { id: Util.uid('u'), nome, email, senhaHash: hashSenha(senha) };
    usuarios.push(novo);
    DB.salvarUsuarios(usuarios);
    DB.salvarDados(novo.id, DB.dadosIniciais());
    return { ok:true, usuario: novo };
  }

  function login(email, senha){
    const usuarios = DB.lerUsuarios();
    const u = usuarios.find(u => u.email.toLowerCase() === email.toLowerCase() && u.senhaHash === hashSenha(senha));
    if (!u) return { ok:false, erro:'E-mail ou senha inválidos.' };
    return { ok:true, usuario: u };
  }

  function logout(){ DB.limparSessao(); }

  return { cadastrar, login, logout };
})();

/* ---------------------------------------------------------------------
   3. ESTADO DA SESSÃO ATIVA (em memória, espelha o localStorage)
--------------------------------------------------------------------- */
const Sessao = {
  usuario: null,   // {id, nome, email}
  dados: null,      // objeto retornado por DB.lerDados
  persistir(){ DB.salvarDados(this.usuario.id, this.dados); }
};

/* ---------------------------------------------------------------------
   4. MÓDULO 1(b) — GESTÃO DE HÁBITOS
--------------------------------------------------------------------- */
const HabitosModule = (() => {
  const ICONES = ['💧','📚','🏃','🧘','🥗','😴','✍️','🎨','💰','🚭','🧹','🎯'];
  const CORES = ['#FF69B4','#CFFF04','#C97B4A','#4f8a5b','#7aa9ff','#b07af2','#ff9770'];

  function habitosAtivos(){ return Sessao.dados.habitos.filter(h => h.ativo); }
  function porId(id){ return Sessao.dados.habitos.find(h => h.id === id); }

  function nomeDuplicado(nome, ignorarId){
    return habitosAtivos().some(h => h.id !== ignorarId && h.nome.trim().toLowerCase() === nome.trim().toLowerCase());
  }

  function criar({nome, categoria, meta, tipoFreq, diasSemana, icone, cor, horaLembrete}){
    nome = nome.trim();
    if (!nome) return { ok:false, erro:'Informe um nome para o hábito.' };
    if (nomeDuplicado(nome)) return { ok:false, erro:'Você já tem um hábito ativo com esse nome.' }; // RF06
    if (tipoFreq === 'semanal' && (!diasSemana || diasSemana.length === 0)){
      return { ok:false, erro:'Selecione ao menos um dia da semana.' };
    }
    const habito = {
      id: Util.uid('h'),
      nome, categoria, meta: meta || '',
      frequencia: tipoFreq === 'semanal' ? { tipo:'semanal', dias:diasSemana } : { tipo:'diaria' },
      icone: icone || ICONES[Math.floor(Math.random()*ICONES.length)],
      cor: cor || CORES[Math.floor(Math.random()*CORES.length)],
      streak: 0, melhorStreak: 0,
      lembreteHora: horaLembrete || '', lembreteAtivo: !!horaLembrete,
      ativo: true,
      criadoEm: Util.chaveHoje()
    };
    Sessao.dados.habitos.push(habito);
    Sessao.persistir();
    return { ok:true, habito };
  }

  function editar(id, {nome, categoria, meta, tipoFreq, diasSemana, icone, cor}){
    const h = porId(id);
    if (!h) return { ok:false, erro:'Hábito não encontrado.' };
    nome = nome.trim();
    if (!nome) return { ok:false, erro:'Informe um nome para o hábito.' };
    if (nomeDuplicado(nome, id)) return { ok:false, erro:'Você já tem um hábito ativo com esse nome.' };
    if (tipoFreq === 'semanal' && (!diasSemana || diasSemana.length === 0)){
      return { ok:false, erro:'Selecione ao menos um dia da semana.' };
    }
    h.nome = nome; h.categoria = categoria; h.meta = meta || '';
    h.frequencia = tipoFreq === 'semanal' ? { tipo:'semanal', dias:diasSemana } : { tipo:'diaria' };
    h.icone = icone; h.cor = cor;
    Sessao.persistir();
    return { ok:true, habito:h };
  }

  function desativar(id){
    const h = porId(id);
    if (!h) return;
    h.ativo = false;
    Sessao.persistir();
  }

  function definirLembrete(id, hora, ativo){
    const h = porId(id);
    if (!h) return;
    h.lembreteHora = hora;
    h.lembreteAtivo = ativo;
    Sessao.persistir();
  }

  function previstoEm(habito, chaveData){
    if (chaveData < habito.criadoEm) return false;
    if (habito.frequencia.tipo === 'diaria') return true;
    return habito.frequencia.dias.includes(Util.diaDaSemana(chaveData));
  }

  function descricaoFrequencia(habito){
    if (habito.frequencia.tipo === 'diaria') return 'Todos os dias';
    const nomes = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    return habito.frequencia.dias.slice().sort().map(d => nomes[d]).join(', ');
  }

  return { ICONES, CORES, habitosAtivos, porId, criar, editar, desativar, definirLembrete, previstoEm, descricaoFrequencia };
})();

/* ---------------------------------------------------------------------
   5. MÓDULO 3 — PONTUAÇÃO (XP e nível)
--------------------------------------------------------------------- */
const PontuacaoModule = (() => {
  const XP_POR_CHECKIN = 10; // fixo, conforme decisão de simplificação do MVP

  // Faixas de nível alinhadas às faixas do estágio da planta (módulo narrativo),
  // reforçando a metáfora de que "nível" e "mundo" crescem juntos.
  const NIVEIS = [
    { nivel:1, min:0,    max:99 },
    { nivel:2, min:100,  max:299 },
    { nivel:3, min:300,  max:599 },
    { nivel:4, min:600,  max:999 },
    { nivel:5, min:1000, max:1499 },
  ];

  function nivelPorXP(xp){
    for (const faixa of NIVEIS){
      if (xp <= faixa.max) return faixa;
    }
    // acima da última faixa fixa: +1 nível a cada 500 XP extras
    const ultimo = NIVEIS[NIVEIS.length-1];
    const extra = Math.floor((xp - ultimo.max - 1) / 500);
    return { nivel: ultimo.nivel + 1 + extra, min: ultimo.max+1+extra*500, max: ultimo.max+500+extra*500 };
  }

  function adicionarXP(qtd){
    Sessao.dados.estado.xp += qtd;
    Sessao.persistir();
  }

  return { XP_POR_CHECKIN, nivelPorXP, adicionarXP };
})();

/* ---------------------------------------------------------------------
   6. MÓDULO 4 — MOTOR NARRATIVO (tema padrão: mundo-planta)
--------------------------------------------------------------------- */
const NarrativaModule = (() => {
  // Extensível: para adicionar um novo "tema" de mundo basta criar outro
  // array de estágios com a mesma forma e trocar a referência ativa.
  const ESTAGIOS = [
    { nome:'Semente',      min:0,    max:99,   emoji:'🌱', desc:'Toda jornada começa pequena. Continue regando seus hábitos.' },
    { nome:'Broto',        min:100,  max:299,  emoji:'🌿', desc:'Os primeiros brotos apareceram — sua consistência está dando resultado!' },
    { nome:'Planta Jovem', min:300,  max:599,  emoji:'🪴', desc:'Suas raízes estão mais fortes a cada dia.' },
    { nome:'Planta Adulta',min:600,  max:999,  emoji:'🌳', desc:'Um exemplo de constância — sua planta já tem tronco firme.' },
    { nome:'Florada',      min:1000, max:Infinity, emoji:'🌸', desc:'Sua dedicação floresceu! Continue cultivando esse ritmo.' },
  ];

  function estagioPorXP(xp){
    return ESTAGIOS.findIndex(e => xp >= e.min && xp <= e.max);
  }

  function registrarEvento(texto, tipo){
    Sessao.dados.eventos.unshift({ id: Util.uid('e'), data: Util.chaveHoje(), texto, tipo });
    Sessao.persistir();
  }

  // Chamado após um check-in NÃO retroativo: verifica se a planta deve evoluir.
  function avaliarEvolucao(){
    const estado = Sessao.dados.estado;
    const novoIndice = estagioPorXP(estado.xp);
    if (novoIndice > estado.estagioPlanta){
      estado.estagioPlanta = novoIndice;
      const est = ESTAGIOS[novoIndice];
      registrarEvento(`${est.emoji} Sua plantinha evoluiu para "${est.nome}"! ${est.desc}`, 'positivo');
      Sessao.persistir();
      return est;
    }
    return null;
  }

  // Chamado pela avaliação de dias pendentes quando há 3 falhas totais seguidas.
  function regredir(){
    const estado = Sessao.dados.estado;
    if (estado.estagioPlanta > 0){
      estado.estagioPlanta -= 1; // nunca abaixo de Semente (índice 0) — RN06
      const est = ESTAGIOS[estado.estagioPlanta];
      registrarEvento(`🥀 Sua planta murchou um pouco após dias sem cuidado. Ela regrediu para "${est.nome}", mas ainda pode se recuperar.`, 'negativo');
    } else {
      registrarEvento('🥀 Sua planta sentiu a falta de cuidado, mas ainda é uma semente cheia de potencial.', 'negativo');
    }
    Sessao.persistir();
  }

  return { ESTAGIOS, estagioPorXP, registrarEvento, avaliarEvolucao, regredir };
})();

/* ---------------------------------------------------------------------
   7. MÓDULO 2 — CHECK-IN DIÁRIO + avaliação automática de falhas
--------------------------------------------------------------------- */
const CheckinModule = (() => {
  function checkinDoDia(habitoId, chaveData){
    return Sessao.dados.checkins.find(c => c.habitoId === habitoId && c.data === chaveData);
  }

  function jaConcluiuHoje(habitoId){ return !!checkinDoDia(habitoId, Util.chaveHoje()); }

  function registrarSucessoNoHabito(habito){
    habito.streak += 1;
    if (habito.streak > habito.melhorStreak) habito.melhorStreak = habito.streak;
  }

  // RF08/RF09/RF11 — check-in do dia atual
  function fazerCheckinHoje(habitoId){
    const habito = HabitosModule.porId(habitoId);
    if (!habito || !habito.ativo) return { ok:false, erro:'Hábito indisponível.' };
    const hoje = Util.chaveHoje();
    if (checkinDoDia(habitoId, hoje)) return { ok:false, erro:'Este hábito já foi concluído hoje.' }; // RN01
    Sessao.dados.checkins.push({ id: Util.uid('c'), habitoId, data: hoje, timestamp: new Date().toISOString(), retroativo:false });
    registrarSucessoNoHabito(habito);
    PontuacaoModule.adicionarXP(PontuacaoModule.XP_POR_CHECKIN);
    Sessao.persistir();
    const evolucao = NarrativaModule.avaliarEvolucao(); // só em check-in não retroativo
    return { ok:true, evolucao };
  }

  // RF10 / RN08 — check-in retroativo (somente "ontem", dentro da janela de 24h)
  function fazerCheckinRetroativo(habitoId){
    const habito = HabitosModule.porId(habitoId);
    if (!habito || !habito.ativo) return { ok:false, erro:'Hábito indisponível.' };
    const ontem = Util.chaveOntem();
    if (!HabitosModule.previstoEm(habito, ontem)) return { ok:false, erro:'Esse hábito não estava previsto para ontem.' };
    if (checkinDoDia(habitoId, ontem)) return { ok:false, erro:'Já existe check-in de ontem para este hábito.' };
    Sessao.dados.checkins.push({ id: Util.uid('c'), habitoId, data: ontem, timestamp: new Date().toISOString(), retroativo:true });
    registrarSucessoNoHabito(habito);
    PontuacaoModule.adicionarXP(PontuacaoModule.XP_POR_CHECKIN);
    // RN08: check-in retroativo não gera evolução narrativa de marco.
    Sessao.persistir();
    return { ok:true };
  }

  // RF12 — "fim de dia" simulado: percorre os dias entre a última avaliação e ontem,
  // registra falhas (zera streak) e aciona regressão narrativa após 3 falhas totais seguidas.
  function avaliarDiasPendentes(){
    const estado = Sessao.dados.estado;
    const ontem = Util.chaveOntem();
    let cursor = Util.somarDias(estado.ultimaDataAvaliada, 1);
    let houveRegressao = false;

    let protecao = 0; // evita loop infinito em datas corrompidas
    while (!Util.chaveMenorQue(ontem, cursor) && protecao < 3650){
      protecao++;
      const habitosNoDia = HabitosModule.habitosAtivos().filter(h => HabitosModule.previstoEm(h, cursor));
      let algumPrevisto = false, algumSucesso = false;
      habitosNoDia.forEach(h => {
        algumPrevisto = true;
        const teveCheckin = !!checkinDoDia(h.id, cursor);
        if (teveCheckin){ algumSucesso = true; }
        else { h.streak = 0; } // falha individual do hábito
      });
      if (algumPrevisto && !algumSucesso){
        estado.falhasConsecutivas += 1;
      } else if (algumPrevisto && algumSucesso){
        estado.falhasConsecutivas = 0;
      }
      // dias sem nenhum hábito previsto não alteram a contagem (dia neutro)
      if (estado.falhasConsecutivas >= 3){
        NarrativaModule.regredir();
        estado.falhasConsecutivas = 0;
        houveRegressao = true;
      }
      cursor = Util.somarDias(cursor, 1);
    }
    estado.ultimaDataAvaliada = ontem;
    Sessao.persistir();
    return houveRegressao;
  }

  function habitosDeHoje(){
    const hoje = Util.chaveHoje();
    return HabitosModule.habitosAtivos().filter(h => HabitosModule.previstoEm(h, hoje));
  }

  function habitosElegiveisRetroativos(){
    const ontem = Util.chaveOntem();
    return HabitosModule.habitosAtivos()
      .filter(h => HabitosModule.previstoEm(h, ontem) && !checkinDoDia(h.id, ontem));
  }

  return { checkinDoDia, jaConcluiuHoje, fazerCheckinHoje, fazerCheckinRetroativo, avaliarDiasPendentes, habitosDeHoje, habitosElegiveisRetroativos };
})();

/* ---------------------------------------------------------------------
   8. MÓDULO 5 — ESTATÍSTICAS E STREAKS
--------------------------------------------------------------------- */
const StatsModule = (() => {
  function taxaConclusao30d(habito){
    const hoje = Util.chaveHoje();
    let previstos = 0, feitos = 0;
    for (let i = 0; i < 30; i++){
      const dia = Util.somarDias(hoje, -i);
      if (dia < habito.criadoEm) continue;
      if (HabitosModule.previstoEm(habito, dia)){
        previstos++;
        if (CheckinModule.checkinDoDia(habito.id, dia)) feitos++;
      }
    }
    return previstos === 0 ? null : Math.round((feitos/previstos)*100);
  }

  // heatmap agregado (todos os hábitos): verde se houve ao menos 1 check-in no dia,
  // terracota se havia hábito previsto e nenhum foi feito, cinza se não havia previsão.
  function heatmap30d(){
    const hoje = Util.chaveHoje();
    const dias = [];
    for (let i = 29; i >= 0; i--){
      const chave = Util.somarDias(hoje, -i);
      const previstosNoDia = HabitosModule.habitosAtivos().filter(h => chave >= h.criadoEm && HabitosModule.previstoEm(h, chave));
      const algumFeito = previstosNoDia.some(h => CheckinModule.checkinDoDia(h.id, chave));
      let status = 'neutro';
      if (chave > hoje) status = 'futuro';
      else if (previstosNoDia.length === 0) status = 'neutro';
      else status = algumFeito ? 'ok' : 'falha';
      dias.push({ chave, status });
    }
    return dias;
  }

  return { taxaConclusao30d, heatmap30d };
})();

/* ---------------------------------------------------------------------
   9. MÓDULO 6 — NOTIFICAÇÕES E LEMBRETES
--------------------------------------------------------------------- */
const NotificacaoModule = (() => {
  let ultimoMinutoChecado = null;
  let intervaloId = null;

  function alternarGlobal(ativo){
    Sessao.dados.config.notificacoesGlobais = ativo;
    Sessao.persistir();
  }

  function verificarLembretes(){
    if (!Sessao.usuario) return;
    if (!Sessao.dados.config.notificacoesGlobais) return;
    const agora = Util.horaAtualHHMM();
    if (agora === ultimoMinutoChecado) return; // evita repetir no mesmo minuto
    ultimoMinutoChecado = agora;

    CheckinModule.habitosDeHoje().forEach(h => {
      if (h.lembreteAtivo && h.lembreteHora === agora && !CheckinModule.jaConcluiuHoje(h.id)){
        UI.mostrarToast(`⏰ Hora de "${h.nome}"! Não esqueça o check-in de hoje.`, 'aviso');
      }
    });
  }

  // RF31 — alerta simples de streak em risco (perto da meia-noite, hábito ainda não feito)
  function habitosEmRisco(){
    const horaAtual = Util.hoje().getHours();
    if (horaAtual < 22) return [];
    return CheckinModule.habitosDeHoje().filter(h => !CheckinModule.jaConcluiuHoje(h.id));
  }

  function iniciar(){
    if (intervaloId) clearInterval(intervaloId);
    intervaloId = setInterval(verificarLembretes, 20000); // checagem periódica (RF30)
    verificarLembretes();
  }

  function parar(){ if (intervaloId) clearInterval(intervaloId); intervaloId = null; ultimoMinutoChecado = null; }

  return { alternarGlobal, verificarLembretes, habitosEmRisco, iniciar, parar };
})();

/* ---------------------------------------------------------------------
   10. UI — renderização e orquestração das telas
--------------------------------------------------------------------- */
const UI = (() => {
  let iconeSelecionado = HabitosModule.ICONES[0];
  let corSelecionada = HabitosModule.CORES[0];
  let diasSelecionados = [];

  function $(sel){ return document.querySelector(sel); }
  function $all(sel){ return document.querySelectorAll(sel); }

  /* ---------- toasts ---------- */
  function mostrarToast(texto, tipo){
    const zona = $('#zona-toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (tipo === 'negativo' ? ' negativo' : tipo === 'aviso' ? ' aviso' : '');
    el.innerHTML = `<span>${Util.escapeHtml(texto)}</span><button class="fech">✕</button>`;
    el.querySelector('.fech').onclick = () => el.remove();
    zona.appendChild(el);
    setTimeout(() => el.remove(), 8000);
  }

  /* ---------- troca de telas (auth) ---------- */
  function mostrarAuth(qual){
    $('#tela-login').classList.toggle('oculto', qual !== 'login');
    $('#tela-cadastro').classList.toggle('oculto', qual !== 'cadastro');
    $('#app').classList.add('oculto');
  }

  function entrarNoApp(){
    $('#tela-login').classList.add('oculto');
    $('#tela-cadastro').classList.add('oculto');
    $('#app').classList.remove('oculto');
    $('#saudacao-usuario').textContent = `Olá, ${Sessao.usuario.nome.split(' ')[0]} 👋`;
    trocarTela('dashboard');
    renderizarTudo();
    NotificacaoModule.iniciar();
  }

  /* ---------- navegação interna ---------- */
  function trocarTela(nome){
    $all('nav.abas button').forEach(b => b.classList.toggle('ativa', b.dataset.tela === nome));
    ['dashboard','mundo','habitos','estatisticas','config'].forEach(t => {
      $('#tela-' + t).classList.toggle('oculto', t !== nome);
    });
    if (nome === 'mundo') renderizarMundo();
    if (nome === 'habitos') renderizarListaHabitos();
    if (nome === 'estatisticas') renderizarEstatisticas();
    if (nome === 'config') renderizarConfig();
  }

  /* ---------- render: topo (xp) ---------- */
  function renderizarTopo(){
    $('#pilula-xp-topo').textContent = `${Sessao.dados.estado.xp} XP`;
  }

  /* ---------- render: dashboard ---------- */
  function renderizarDashboard(){
    const estado = Sessao.dados.estado;
    const estagio = NarrativaModule.ESTAGIOS[estado.estagioPlanta];
    $('#dash-emoji-planta').textContent = estagio.emoji;
    $('#dash-nome-estagio').textContent = estagio.nome;
    $('#dash-desc-estagio').textContent = estagio.desc;

    const nivel = PontuacaoModule.nivelPorXP(estado.xp);
    const spanFaixa = nivel.max - nivel.min + 1;
    const progresso = Math.min(100, Math.round(((estado.xp - nivel.min) / spanFaixa) * 100));
    $('#dash-barra-xp').style.width = progresso + '%';
    $('#dash-xp-atual').textContent = `${estado.xp} XP`;
    $('#dash-xp-prox').textContent = isFinite(nivel.max) ? `próx. nível: ${nivel.max+1} XP` : '';
    $('#dash-nivel').textContent = `Nível ${nivel.nivel}`;

    const risco = NotificacaoModule.habitosEmRisco();
    $('#dash-aviso-risco').innerHTML = risco.length
      ? `<div class="aviso-risco">⚠️ ${risco.length} hábito(s) ainda não concluído(s) hoje — a streak pode acabar à meia-noite: <b>${risco.map(h=>Util.escapeHtml(h.nome)).join(', ')}</b></div>`
      : '';

    const lista = $('#lista-checkin-hoje');
    const habitosHoje = CheckinModule.habitosDeHoje();
    if (habitosHoje.length === 0){
      lista.innerHTML = `<div class="vazio"><span class="grande">🍃</span>Nenhum hábito previsto para hoje.<br>Aproveite para cadastrar um novo na aba "Hábitos".</div>`;
      return;
    }
    lista.innerHTML = habitosHoje.map(h => {
      const feito = CheckinModule.jaConcluiuHoje(h.id);
      return `
      <div class="cartao-habito ${feito?'concluido':''}">
        <div class="icone-habito" style="background:${h.cor}22; color:${h.cor}">${h.icone}</div>
        <div class="info-habito">
          <div class="nome">${Util.escapeHtml(h.nome)}</div>
          <div class="meta">${Util.escapeHtml(h.categoria)} · ${HabitosModule.descricaoFrequencia(h)}${h.meta ? ' · Meta: '+Util.escapeHtml(h.meta) : ''}</div>
        </div>
        <span class="badge-streak">🔥 ${h.streak}</span>
        <div class="acoes-habito">
          <button class="btn-check ${feito?'feito':''}" data-checkin="${h.id}" ${feito?'disabled':''} title="${feito?'Concluído':'Marcar como concluído'}">${feito?'✓':'○'}</button>
        </div>
      </div>`;
    }).join('');

    lista.querySelectorAll('[data-checkin]').forEach(btn => {
      btn.addEventListener('click', () => {
        const res = CheckinModule.fazerCheckinHoje(btn.dataset.checkin);
        if (!res.ok){ mostrarToast(res.erro, 'negativo'); return; }
        mostrarToast('✅ Check-in registrado! +10 XP', 'positivo');
        if (res.evolucao){ mostrarToast(`${res.evolucao.emoji} Sua planta evoluiu para "${res.evolucao.nome}"!`, 'positivo'); }
        renderizarTudo();
      });
    });
  }

  /* ---------- render: meu mundo ---------- */
  function renderizarMundo(){
    const estado = Sessao.dados.estado;
    const estagio = NarrativaModule.ESTAGIOS[estado.estagioPlanta];
    $('#mundo-emoji-planta').textContent = estagio.emoji;
    $('#mundo-nome-estagio').textContent = estagio.nome;
    $('#mundo-desc-estagio').textContent = estagio.desc;

    $('#mundo-trilha').innerHTML = NarrativaModule.ESTAGIOS.map((e,i) => {
      const cls = i === estado.estagioPlanta ? 'atual' : (i < estado.estagioPlanta ? 'alcancado' : '');
      return `<span class="marco-estagio ${cls}">${e.emoji} ${e.nome}</span>`;
    }).join('');

    const eventos = Sessao.dados.eventos.slice(0, 20);
    $('#lista-eventos').innerHTML = eventos.length ? eventos.map(ev => `
      <div class="item-evento ${ev.tipo === 'negativo' ? 'negativo' : ''}">
        <b>${Util.formatarDataBR(ev.data)}</b> — ${Util.escapeHtml(ev.texto)}
      </div>`).join('') : `<div class="vazio"><span class="grande">📜</span>Nenhum evento ainda. Continue com seus check-ins!</div>`;
  }

  /* ---------- render: lista de hábitos (tela de gestão) ---------- */
  function renderizarListaHabitos(){
    const lista = $('#lista-todos-habitos');
    const habitos = HabitosModule.habitosAtivos();
    if (habitos.length === 0){
      lista.innerHTML = `<div class="vazio cartao"><span class="grande">🌾</span>Você ainda não tem hábitos. Clique em "+ Novo hábito" para plantar o primeiro.</div>`;
      return;
    }
    lista.innerHTML = habitos.map(h => `
      <div class="cartao-habito cartao">
        <div class="icone-habito" style="background:${h.cor}22; color:${h.cor}">${h.icone}</div>
        <div class="info-habito">
          <div class="nome">${Util.escapeHtml(h.nome)}</div>
          <div class="meta">${Util.escapeHtml(h.categoria)} · ${HabitosModule.descricaoFrequencia(h)}${h.meta ? ' · Meta: '+Util.escapeHtml(h.meta) : ''}</div>
        </div>
        <span class="badge-streak">🔥 ${h.streak} · 🏆 ${h.melhorStreak}</span>
        <div class="acoes-habito">
          <button class="botao botao-fantasma botao-peq" data-editar="${h.id}">Editar</button>
        </div>
      </div>`).join('');

    lista.querySelectorAll('[data-editar]').forEach(btn => {
      btn.addEventListener('click', () => abrirModalHabito(HabitosModule.porId(btn.dataset.editar)));
    });
  }

  /* ---------- render: estatísticas ---------- */
  function renderizarEstatisticas(){
    const habitos = HabitosModule.habitosAtivos();

    $('#grade-stats-habitos').innerHTML = habitos.length ? habitos.map(h => {
      const taxa = StatsModule.taxaConclusao30d(h);
      return `
      <div class="cartao stat-habito">
        <h4><span>${h.icone}</span> ${Util.escapeHtml(h.nome)}</h4>
        <div class="stat-linha"><span>Streak atual</span><b>🔥 ${h.streak} dias</b></div>
        <div class="stat-linha"><span>Melhor streak</span><b>🏆 ${h.melhorStreak} dias</b></div>
        <div class="stat-linha"><span>Conclusão (30 dias)</span><b>${taxa === null ? '—' : taxa+'%'}</b></div>
      </div>`;
    }).join('') : `<div class="vazio cartao"><span class="grande">📊</span>Cadastre hábitos para ver suas estatísticas.</div>`;

    const dias = StatsModule.heatmap30d();
    $('#heatmap-30').innerHTML = dias.map(d =>
      `<div class="dia-heat ${d.status==='ok'?'ok':d.status==='falha'?'falha':''}" title="${Util.formatarDataBR(d.chave)}"></div>`
    ).join('');

    const barras = $('#barra-comparativo');
    if (habitos.length === 0){
      barras.innerHTML = `<div class="vazio"><span class="grande">📈</span>Nenhum hábito para comparar ainda.</div>`;
    } else {
      barras.innerHTML = habitos.map(h => {
        const taxa = StatsModule.taxaConclusao30d(h) ?? 0;
        return `
        <div class="linha-barra">
          <span class="rotulo" title="${Util.escapeHtml(h.nome)}">${h.icone} ${Util.escapeHtml(h.nome)}</span>
          <div class="trilho-barra"><div class="preench-barra" style="width:${taxa}%; background:${h.cor}"></div></div>
          <span class="valor-barra">${taxa}%</span>
        </div>`;
      }).join('');
    }
  }

  /* ---------- render: configurações ---------- */
  function renderizarConfig(){
    $('#chk-notif-global').checked = Sessao.dados.config.notificacoesGlobais;
    const habitos = HabitosModule.habitosAtivos();
    const lista = $('#lista-config-habitos');
    lista.innerHTML = habitos.length ? habitos.map(h => `
      <div class="linha-config">
        <div class="nome">${h.icone} ${Util.escapeHtml(h.nome)}</div>
        <input type="time" class="input-hora" value="${h.lembreteHora || ''}" data-hora="${h.id}">
        <label class="interruptor">
          <input type="checkbox" data-toggle="${h.id}" ${h.lembreteAtivo ? 'checked':''}>
          <span class="trilha"></span>
        </label>
      </div>`).join('') : `<p class="subtitulo">Cadastre hábitos para configurar lembretes.</p>`;

    lista.querySelectorAll('[data-hora]').forEach(inp => {
      inp.addEventListener('change', () => {
        const h = HabitosModule.porId(inp.dataset.hora);
        HabitosModule.definirLembrete(h.id, inp.value, h.lembreteAtivo);
      });
    });
    lista.querySelectorAll('[data-toggle]').forEach(chk => {
      chk.addEventListener('change', () => {
        const h = HabitosModule.porId(chk.dataset.toggle);
        HabitosModule.definirLembrete(h.id, h.lembreteHora, chk.checked);
      });
    });
  }

  /* ---------- modal: novo/editar hábito ---------- */
  function montarSeletoresModal(){
    $('#linha-icones').innerHTML = HabitosModule.ICONES.map(i =>
      `<button type="button" class="opcao-icone" data-icone="${i}">${i}</button>`).join('');
    $('#linha-cores').innerHTML = HabitosModule.CORES.map(c =>
      `<button type="button" class="opcao-cor" data-cor="${c}" style="background:${c}"></button>`).join('');
    $('#linha-dias-semana').innerHTML = ['D','S','T','Q','Q','S','S'].map((n,i) =>
      `<button type="button" class="chip-dia" data-dia="${i}">${n}</button>`).join('');

    $all('[data-icone]').forEach(b => b.addEventListener('click', () => {
      iconeSelecionado = b.dataset.icone;
      $all('[data-icone]').forEach(x => x.classList.toggle('sel', x === b));
    }));
    $all('[data-cor]').forEach(b => b.addEventListener('click', () => {
      corSelecionada = b.dataset.cor;
      $all('[data-cor]').forEach(x => x.classList.toggle('sel', x === b));
    }));
    $all('[data-dia]').forEach(b => b.addEventListener('click', () => {
      const d = Number(b.dataset.dia);
      if (diasSelecionados.includes(d)) diasSelecionados = diasSelecionados.filter(x => x !== d);
      else diasSelecionados.push(d);
      b.classList.toggle('ativo');
    }));
  }

  function abrirModalHabito(habitoExistente){
    $('#erro-habito').textContent = '';
    $('#form-habito').reset();
    $('#habito-id').value = habitoExistente ? habitoExistente.id : '';
    $('#modal-habito-titulo').textContent = habitoExistente ? 'Editar hábito' : 'Novo hábito';
    $('#btn-excluir-habito').style.display = habitoExistente ? 'inline-flex' : 'none';

    iconeSelecionado = habitoExistente ? habitoExistente.icone : HabitosModule.ICONES[Math.floor(Math.random()*HabitosModule.ICONES.length)];
    corSelecionada = habitoExistente ? habitoExistente.cor : HabitosModule.CORES[Math.floor(Math.random()*HabitosModule.CORES.length)];
    diasSelecionados = habitoExistente && habitoExistente.frequencia.tipo === 'semanal' ? [...habitoExistente.frequencia.dias] : [];

    if (habitoExistente){
      $('#habito-nome').value = habitoExistente.nome;
      $('#habito-categoria').value = habitoExistente.categoria;
      $('#habito-meta').value = habitoExistente.meta;
      $('#habito-freq-tipo').value = habitoExistente.frequencia.tipo;
    }
    $('#wrap-dias-semana').classList.toggle('oculto', $('#habito-freq-tipo').value !== 'semanal');

    $all('[data-icone]').forEach(x => x.classList.toggle('sel', x.dataset.icone === iconeSelecionado));
    $all('[data-cor]').forEach(x => x.classList.toggle('sel', x.dataset.cor === corSelecionada));
    $all('[data-dia]').forEach(x => x.classList.toggle('ativo', diasSelecionados.includes(Number(x.dataset.dia))));

    $('#modal-habito').classList.remove('oculto');
  }

  function fecharModalHabito(){ $('#modal-habito').classList.add('oculto'); }

  /* ---------- modal: check-in retroativo ---------- */
  function abrirModalRetro(){
    const elegiveis = CheckinModule.habitosElegiveisRetroativos();
    const lista = $('#lista-retro');
    lista.innerHTML = elegiveis.length ? elegiveis.map(h => `
      <div class="cartao-habito">
        <div class="icone-habito" style="background:${h.cor}22; color:${h.cor}">${h.icone}</div>
        <div class="info-habito">
          <div class="nome">${Util.escapeHtml(h.nome)}</div>
          <div class="meta">Previsto para ontem (${Util.formatarDataBR(Util.chaveOntem())})</div>
        </div>
        <button class="botao botao-primario botao-peq" data-retro="${h.id}">Marcar</button>
      </div>`).join('') : `<div class="vazio"><span class="grande">🎉</span>Nenhum hábito pendente de ontem.</div>`;

    lista.querySelectorAll('[data-retro]').forEach(btn => {
      btn.addEventListener('click', () => {
        const res = CheckinModule.fazerCheckinRetroativo(btn.dataset.retro);
        if (!res.ok){ mostrarToast(res.erro, 'negativo'); return; }
        mostrarToast('✅ Check-in retroativo registrado! +10 XP', 'positivo');
        abrirModalRetro();
        renderizarTudo();
      });
    });
    $('#modal-retro').classList.remove('oculto');
  }

  function renderizarTudo(){
    renderizarTopo();
    renderizarDashboard();
    // as demais telas são renderizadas sob demanda ao trocar de aba (trocarTela)
  }

  return {
    mostrarToast, mostrarAuth, entrarNoApp, trocarTela,
    renderizarTudo, renderizarDashboard, renderizarMundo, renderizarListaHabitos, renderizarEstatisticas, renderizarConfig,
    montarSeletoresModal, abrirModalHabito, fecharModalHabito, abrirModalRetro,
    get iconeSelecionado(){ return iconeSelecionado; }, get corSelecionada(){ return corSelecionada; }, get diasSelecionados(){ return diasSelecionados; }
  };
})();

/* ---------------------------------------------------------------------
   11. DADOS DE DEMONSTRAÇÃO
   Cria (se ainda não existir) um usuário de exemplo com hábitos e
   histórico de check-ins, já com a planta no estágio "Broto".
--------------------------------------------------------------------- */
function garantirUsuarioDemo(){
  const usuarios = DB.lerUsuarios();
  if (usuarios.some(u => u.email === 'demo@raizviva.com')) return;

  const r = AuthModule.cadastrar('Usuário Demo', 'demo@raizviva.com', '123456');
  const dados = DB.lerDados(r.usuario.id);

  const h1 = { id: Util.uid('h'), nome:'Beber água', categoria:'Saúde', meta:'2L por dia',
    frequencia:{tipo:'diaria'}, icone:'💧', cor:'#7aa9ff', streak:0, melhorStreak:0,
    lembreteHora:'08:00', lembreteAtivo:true, ativo:true, criadoEm: Util.somarDias(Util.chaveHoje(), -10) };
  const h2 = { id: Util.uid('h'), nome:'Ler 10 páginas', categoria:'Estudo', meta:'',
    frequencia:{tipo:'diaria'}, icone:'📚', cor:'#C97B4A', streak:0, melhorStreak:0,
    lembreteHora:'20:00', lembreteAtivo:false, ativo:true, criadoEm: Util.somarDias(Util.chaveHoje(), -10) };
  const h3 = { id: Util.uid('h'), nome:'Corrida leve', categoria:'Saúde', meta:'20 min',
    frequencia:{tipo:'semanal', dias:[1,3,5]}, icone:'🏃', cor:'#FF69B4', streak:0, melhorStreak:0,
    lembreteHora:'', lembreteAtivo:false, ativo:true, criadoEm: Util.somarDias(Util.chaveHoje(), -10) };
  dados.habitos.push(h1, h2, h3);

  // histórico dos últimos 6 dias (sem contar hoje) só para h1 e h2, gerando streak e XP
  for (let i = 6; i >= 1; i--){
    const dia = Util.somarDias(Util.chaveHoje(), -i);
    [h1, h2].forEach(h => {
      dados.checkins.push({ id: Util.uid('c'), habitoId: h.id, data: dia, timestamp: dia+'T09:00:00.000Z', retroativo:false });
      h.streak += 1;
      if (h.streak > h.melhorStreak) h.melhorStreak = h.streak;
    });
    dados.estado.xp += 20; // 10 XP x 2 hábitos
  }
  dados.estado.ultimaDataAvaliada = Util.chaveOntem();
  dados.estado.estagioPlanta = NarrativaModule.estagioPorXP(dados.estado.xp);
  dados.eventos.push({ id: Util.uid('e'), data: Util.somarDias(Util.chaveHoje(),-4), texto:'🌿 Sua plantinha evoluiu para "Broto"! Os primeiros brotos apareceram.', tipo:'positivo' });

  DB.salvarDados(r.usuario.id, dados);
}

/* ---------------------------------------------------------------------
   12. INICIALIZAÇÃO / EVENTOS DE FORMULÁRIO
--------------------------------------------------------------------- */
function iniciarSessaoUsuario(usuario){
  Sessao.usuario = usuario;
  Sessao.dados = DB.lerDados(usuario.id);
  CheckinModule.avaliarDiasPendentes(); // simula o "fim de dia" que passou desde a última visita
  DB.salvarSessao(usuario.id);
  UI.entrarNoApp();
}

document.addEventListener('DOMContentLoaded', () => {
  garantirUsuarioDemo();
  UI.montarSeletoresModal();

  // ---- navegação login/cadastro ----
  document.getElementById('ir-cadastro').addEventListener('click', () => UI.mostrarAuth('cadastro'));
  document.getElementById('ir-login').addEventListener('click', () => UI.mostrarAuth('login'));

  // ---- login ----
  document.getElementById('form-login').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const senha = document.getElementById('login-senha').value;
    const res = AuthModule.login(email, senha);
    const erroEl = document.getElementById('erro-login');
    if (!res.ok){ erroEl.textContent = res.erro; return; }
    erroEl.textContent = '';
    iniciarSessaoUsuario(res.usuario);
  });

  // ---- cadastro ----
  document.getElementById('form-cadastro').addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = document.getElementById('cad-nome').value.trim();
    const email = document.getElementById('cad-email').value.trim();
    const senha = document.getElementById('cad-senha').value;
    const erroEl = document.getElementById('erro-cadastro');
    if (senha.length < 4){ erroEl.textContent = 'A senha deve ter ao menos 4 caracteres.'; return; }
    const res = AuthModule.cadastrar(nome, email, senha);
    if (!res.ok){ erroEl.textContent = res.erro; return; }
    erroEl.textContent = '';
    iniciarSessaoUsuario(res.usuario);
  });

  // ---- logout ----
  document.getElementById('btn-logout').addEventListener('click', () => {
    AuthModule.logout();
    NotificacaoModule.parar();
    Sessao.usuario = null; Sessao.dados = null;
    document.getElementById('form-login').reset();
    UI.mostrarAuth('login');
  });

  // ---- navegação interna (abas) ----
  document.querySelectorAll('nav.abas button').forEach(btn => {
    btn.addEventListener('click', () => UI.trocarTela(btn.dataset.tela));
  });

  // ---- modal hábito: abrir/fechar ----
  document.getElementById('btn-novo-habito').addEventListener('click', () => UI.abrirModalHabito(null));
  document.getElementById('btn-cancelar-habito').addEventListener('click', UI.fecharModalHabito);
  document.getElementById('modal-habito').addEventListener('click', (e) => { if (e.target.id === 'modal-habito') UI.fecharModalHabito(); });

  document.getElementById('habito-freq-tipo').addEventListener('change', (e) => {
    document.getElementById('wrap-dias-semana').classList.toggle('oculto', e.target.value !== 'semanal');
  });

  document.getElementById('form-habito').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('habito-id').value;
    const dadosForm = {
      nome: document.getElementById('habito-nome').value,
      categoria: document.getElementById('habito-categoria').value,
      meta: document.getElementById('habito-meta').value,
      tipoFreq: document.getElementById('habito-freq-tipo').value,
      diasSemana: UI.diasSelecionados,
      icone: UI.iconeSelecionado,
      cor: UI.corSelecionada
    };
    const res = id ? HabitosModule.editar(id, dadosForm) : HabitosModule.criar(dadosForm);
    if (!res.ok){ document.getElementById('erro-habito').textContent = res.erro; return; }
    UI.fecharModalHabito();
    UI.mostrarToast(id ? '✏️ Hábito atualizado.' : '🌱 Hábito criado com sucesso!', 'positivo');
    UI.renderizarTudo();
    UI.renderizarListaHabitos();
  });

  document.getElementById('btn-excluir-habito').addEventListener('click', () => {
    const id = document.getElementById('habito-id').value;
    if (!id) return;
    if (!confirm('Deseja desativar este hábito? Ele deixará de aparecer no check-in diário.')) return;
    HabitosModule.desativar(id);
    UI.fecharModalHabito();
    UI.mostrarToast('Hábito desativado.', 'aviso');
    UI.renderizarTudo();
    UI.renderizarListaHabitos();
  });

  // ---- modal check-in retroativo ----
  document.getElementById('btn-abrir-retro').addEventListener('click', UI.abrirModalRetro);
  document.getElementById('btn-fechar-retro').addEventListener('click', () => document.getElementById('modal-retro').classList.add('oculto'));
  document.getElementById('modal-retro').addEventListener('click', (e) => { if (e.target.id === 'modal-retro') e.target.classList.add('oculto'); });

  // ---- configurações: notificações globais ----
  document.getElementById('chk-notif-global').addEventListener('change', (e) => {
    NotificacaoModule.alternarGlobal(e.target.checked);
  });

  // ---- retomar sessão já existente (ex.: F5) ----
  const sessaoExistente = DB.lerSessao();
  if (sessaoExistente){
    const usuarios = DB.lerUsuarios();
    const u = usuarios.find(u => u.id === sessaoExistente);
    if (u) iniciarSessaoUsuario(u);
    else UI.mostrarAuth('login');
  } else {
    UI.mostrarAuth('login');
  }
});
