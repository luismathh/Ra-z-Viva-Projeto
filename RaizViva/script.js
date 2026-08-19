/* =====================================================================
   UTIL — helpers de data e id, usados por todo o resto do app
   ===================================================================== */
class Util {
  static uid(prefixo = 'id') {
    return `${prefixo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  static chaveData(data) {
    const y = data.getFullYear();
    const m = String(data.getMonth() + 1).padStart(2, '0');
    const d = String(data.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  static chaveHoje() {
    return Util.chaveData(new Date());
  }

  static chaveOntem() {
    return Util.somarDias(Util.chaveHoje(), -1);
  }

  static somarDias(chave, n) {
    const [y, m, d] = chave.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return Util.chaveData(dt);
  }

  static diaDaSemana(chave) {
    const [y, m, d] = chave.split('-').map(Number);
    return new Date(y, m - 1, d).getDay();
  }

  static formatarDataBR(chave) {
    const [y, m, d] = chave.split('-');
    return `${d}/${m}/${y}`;
  }
}

/* =====================================================================
   MODELOS DE DOMÍNIO
   ===================================================================== */
class Habito {
  constructor({
    id,
    nome,
    categoria,
    meta = '',
    frequencia = { tipo: 'diaria' },
    icone,
    cor,
    streak = 0,
    melhorStreak = 0,
    lembreteHora = '',
    lembreteAtivo = false,
    ativo = true,
    criadoEm
  }) {
    this.id = id;
    this.nome = nome;
    this.categoria = categoria;
    this.meta = meta;
    this.frequencia = frequencia;
    this.icone = icone;
    this.cor = cor;
    this.streak = streak;
    this.melhorStreak = melhorStreak;
    this.lembreteHora = lembreteHora;
    this.lembreteAtivo = lembreteAtivo;
    this.ativo = ativo;
    this.criadoEm = criadoEm;
  }

  estaAtivo() {
    return this.ativo;
  }

  preverPara(data) {
    if (data < this.criadoEm) {
      return false;
    }

    if (this.frequencia.tipo === 'diaria') {
      return true;
    }

    const dia = Util.diaDaSemana(data);
    return this.frequencia.dias.includes(dia);
  }

  registrarSucesso() {
    this.streak++;

    if (this.streak > this.melhorStreak) {
      this.melhorStreak = this.streak;
    }
  }

  registrarFalha() {
    this.streak = 0;
  }

  editar(dados) {
    this.nome = dados.nome.trim();
    this.categoria = dados.categoria;
    this.meta = dados.meta || '';

    this.frequencia =
      dados.tipoFreq === 'semanal'
        ? {
            tipo: 'semanal',
            dias: [...dados.diasSemana]
          }
        : {
            tipo: 'diaria'
          };

    this.icone = dados.icone;
    this.cor = dados.cor;
  }

  desativar() {
    this.ativo = false;
  }

  definirLembrete(hora, ativo) {
    this.lembreteHora = hora;
    this.lembreteAtivo = ativo;
  }
}
class GerenciadorHabitos {
  constructor(sessao) {
    this.sessao = sessao;
  }

  listarAtivos() {
    return this.sessao.dados.habitos
      .filter(h => h.ativo)
      .map(h => h instanceof Habito ? h : new Habito(h));
  }

  buscarPorId(id) {
    const habit = this.sessao.dados.habitos.find(h => h.id === id);

    if (!habit) {
      return null;
    }

    return habit instanceof Habito
      ? habit
      : new Habito(habit);
  }

  nomeDuplicado(nome, ignorarId = null) {
    const nomeNormalizado = nome.trim().toLowerCase();

    return this.listarAtivos().some(h =>
      h.id !== ignorarId &&
      h.nome.trim().toLowerCase() === nomeNormalizado
    );
  }

  criar(dados) {
    const nome = dados.nome.trim();

    if (!nome) {
      return {
        ok: false,
        erro: 'Informe um nome para o hábito.'
      };
    }

    if (this.nomeDuplicado(nome)) {
      return {
        ok: false,
        erro: 'Você já tem um hábito ativo com esse nome.'
      };
    }

    if (
      dados.tipoFreq === 'semanal' &&
      (!dados.diasSemana || dados.diasSemana.length === 0)
    ) {
      return {
        ok: false,
        erro: 'Selecione ao menos um dia da semana.'
      };
    }

    const habito = new Habito({
      id: Util.uid('h'),
      nome,
      categoria: dados.categoria,
      meta: dados.meta || '',
      frequencia:
        dados.tipoFreq === 'semanal'
          ? {
              tipo: 'semanal',
              dias: [...dados.diasSemana]
            }
          : {
              tipo: 'diaria'
            },
      icone: dados.icone,
      cor: dados.cor,
      criadoEm: Util.chaveHoje()
    });

    this.sessao.dados.habitos.push(habito);

    this.sessao.salvar();

    return {
      ok: true,
      habito
    };
  }

  editar(id, dados) {
    const habito = this.buscarPorId(id);

    if (!habito) {
      return {
        ok: false,
        erro: 'Hábito não encontrado.'
      };
    }

    const nome = dados.nome.trim();

    if (!nome) {
      return {
        ok: false,
        erro: 'Informe um nome para o hábito.'
      };
    }

    if (this.nomeDuplicado(nome, id)) {
      return {
        ok: false,
        erro: 'Você já tem um hábito ativo com esse nome.'
      };
    }

    habito.editar({
      ...dados,
      nome
    });

    this.sessao.salvar();

    return {
      ok: true,
      habito
    };
  }

  desativar(id) {
    const habito = this.buscarPorId(id);

    if (!habito) {
      return false;
    }

    habito.desativar();
    this.sessao.salvar();

    return true;
  }
}
class Sessao {
  constructor(banco) {
    this.banco = banco;
    this.usuario = null;
    this.dados = null;
  }

  iniciar(usuario) {
    this.usuario = usuario;
    this.dados = this.banco.lerDados(usuario.id);

    if (!this.dados) {
      this.dados = this.banco.dadosIniciais();
    }
  }

  salvar() {
    if (!this.usuario) {
      return;
    }

    this.banco.salvarDados(
      this.usuario.id,
      this.dados
    );
  }

  encerrar() {
    this.usuario = null;
    this.dados = null;
  }

  estaAutenticada() {
    return this.usuario !== null;
  }
}
class Checkin {
  constructor({
    id,
    habitoId,
    data,
    timestamp,
    retroativo = false
  }) {
    this.id = id;
    this.habitoId = habitoId;
    this.data = data;
    this.timestamp = timestamp;
    this.retroativo = retroativo;
  }
}
class GerenciadorCheckins {
  constructor(sessao, habitos, pontuacao, narrativa) {
    this.sessao = sessao;
    this.habitos = habitos;
    this.pontuacao = pontuacao;
    this.narrativa = narrativa;
  }

  buscar(habitoId, data) {
    return this.sessao.dados.checkins.find(
      c =>
        c.habitoId === habitoId &&
        c.data === data
    );
  }

  jaConcluiuHoje(habitoId) {
    return !!this.buscar(
      habitoId,
      Util.chaveHoje()
    );
  }

  fazerHoje(habitoId) {
    const habito = this.habitos.buscarPorId(habitoId);

    if (!habito || !habito.ativo) {
      return {
        ok: false,
        erro: 'Hábito indisponível.'
      };
    }

    const hoje = Util.chaveHoje();

    if (this.buscar(habitoId, hoje)) {
      return {
        ok: false,
        erro: 'Este hábito já foi concluído hoje.'
      };
    }

    const checkin = new Checkin({
      id: Util.uid('c'),
      habitoId,
      data: hoje,
      timestamp: new Date().toISOString(),
      retroativo: false
    });

    this.sessao.dados.checkins.push(checkin);

    habito.registrarSucesso();

    this.pontuacao.adicionarXP(
      Pontuacao.XP_POR_CHECKIN
    );

    this.sessao.dados.estado.falhasConsecutivas = 0;

    this.sessao.salvar();

    const evolucao =
      this.narrativa.avaliarEvolucao();

    return {
      ok: true,
      evolucao
    };
  }

  fazerRetroativo(habitoId) {
    const habito = this.habitos.buscarPorId(habitoId);

    if (!habito || !habito.ativo) {
      return {
        ok: false,
        erro: 'Hábito indisponível.'
      };
    }

    const ontem = Util.chaveOntem();

    if (!habito.preverPara(ontem)) {
      return {
        ok: false,
        erro: 'Esse hábito não estava previsto para ontem.'
      };
    }

    if (this.buscar(habitoId, ontem)) {
      return {
        ok: false,
        erro: 'Já existe check-in de ontem para este hábito.'
      };
    }

    this.sessao.dados.checkins.push(
      new Checkin({
        id: Util.uid('c'),
        habitoId,
        data: ontem,
        timestamp: new Date().toISOString(),
        retroativo: true
      })
    );

    habito.registrarSucesso();

    this.pontuacao.adicionarXP(
      Pontuacao.XP_POR_CHECKIN
    );

    this.sessao.salvar();

    return {
      ok: true
    };
  }

  habitosDeHoje() {
    const hoje = Util.chaveHoje();

    return this.habitos
      .listarAtivos()
      .filter(h => h.preverPara(hoje));
  }

  /**
   * Percorre os dias entre a última avaliação e ontem (o dia de hoje nunca
   * é avaliado, pois ainda está em andamento). Para cada dia em que havia
   * hábitos previstos e algum não foi cumprido, registra falha nesses
   * hábitos e conta como uma falha consecutiva do "mundo". Duas falhas
   * consecutivas fazem a planta regredir de estágio.
   */
  avaliarDiasPendentes() {
    const estado = this.sessao.dados.estado;
    const ontem = Util.chaveOntem();

    let cursor = Util.somarDias(estado.ultimaDataAvaliada, 1);

    while (cursor <= ontem) {
      const previstos = this.habitos
        .listarAtivos()
        .filter(h => h.preverPara(cursor));

      if (previstos.length > 0) {
        const algumaFalha = previstos.some(
          h => !this.buscar(h.id, cursor)
        );

        if (algumaFalha) {
          previstos.forEach(h => {
            if (!this.buscar(h.id, cursor)) {
              h.registrarFalha();
            }
          });

          estado.falhasConsecutivas++;

          if (estado.falhasConsecutivas >= 2) {
            this.narrativa.regredir();
            estado.falhasConsecutivas = 0;
          }
        } else {
          estado.falhasConsecutivas = 0;
        }
      }

      cursor = Util.somarDias(cursor, 1);
    }

    estado.ultimaDataAvaliada = ontem;
    this.sessao.salvar();
  }
}
class Pontuacao {
  static XP_POR_CHECKIN = 10;

  constructor(sessao) {
    this.sessao = sessao;
  }

  get xp() {
    return this.sessao.dados.estado.xp;
  }

  adicionarXP(qtd) {
    this.sessao.dados.estado.xp += qtd;
    this.sessao.salvar();
  }

  nivelAtual() {
    const xp = this.xp;

    if (xp < 100) {
      return {
        nivel: 1,
        min: 0,
        max: 99
      };
    }

    if (xp < 300) {
      return {
        nivel: 2,
        min: 100,
        max: 299
      };
    }

    if (xp < 600) {
      return {
        nivel: 3,
        min: 300,
        max: 599
      };
    }

    if (xp < 1000) {
      return {
        nivel: 4,
        min: 600,
        max: 999
      };
    }

    if (xp < 1500) {
      return {
        nivel: 5,
        min: 1000,
        max: 1499
      };
    }

    const extra =
      Math.floor((xp - 1500) / 500);

    return {
      nivel: 6 + extra,
      min: 1500 + extra * 500,
      max: 1999 + extra * 500
    };
  }
}
class Narrativa {
  static ESTAGIOS = [
    {
      nome: 'Semente',
      min: 0,
      max: 99,
      emoji: '🌱',
      desc: 'Toda jornada começa pequena. Continue regando seus hábitos.'
    },
    {
      nome: 'Broto',
      min: 100,
      max: 299,
      emoji: '🌿',
      desc: 'Os primeiros brotos apareceram — sua consistência está dando resultado!'
    },
    {
      nome: 'Planta Jovem',
      min: 300,
      max: 599,
      emoji: '🪴',
      desc: 'Suas raízes estão mais fortes a cada dia.'
    },
    {
      nome: 'Planta Adulta',
      min: 600,
      max: 999,
      emoji: '🌳',
      desc: 'Um exemplo de constância — sua planta já tem tronco firme.'
    },
    {
      nome: 'Florada',
      min: 1000,
      max: Infinity,
      emoji: '🌸',
      desc: 'Sua dedicação floresceu! Continue cultivando esse ritmo.'
    }
  ];

  constructor(sessao) {
    this.sessao = sessao;
  }

  estagioPorXP(xp) {
    return Narrativa.ESTAGIOS.findIndex(
      estagio =>
        xp >= estagio.min &&
        xp <= estagio.max
    );
  }

  avaliarEvolucao() {
    const estado = this.sessao.dados.estado;

    const novoEstagio =
      this.estagioPorXP(estado.xp);

    if (novoEstagio <= estado.estagioPlanta) {
      return null;
    }

    estado.estagioPlanta = novoEstagio;

    const estagio =
      Narrativa.ESTAGIOS[novoEstagio];

    this.registrarEvento(
      `${estagio.emoji} Sua plantinha evoluiu para "${estagio.nome}"! ${estagio.desc}`,
      'positivo'
    );

    this.sessao.salvar();

    return estagio;
  }

  regredir() {
    const estado = this.sessao.dados.estado;

    if (estado.estagioPlanta > 0) {
      estado.estagioPlanta--;

      const estagio =
        Narrativa.ESTAGIOS[
          estado.estagioPlanta
        ];

      this.registrarEvento(
        `🥀 Sua planta murchou um pouco após dias sem cuidado. Ela regrediu para "${estagio.nome}", mas ainda pode se recuperar.`,
        'negativo'
      );
    }

    this.sessao.salvar();
  }

  registrarEvento(texto, tipo) {
    this.sessao.dados.eventos.unshift({
      id: Util.uid('e'),
      data: Util.chaveHoje(),
      texto,
      tipo
    });

    this.sessao.salvar();
  }
}
class BancoDados {
  static CHAVE_USUARIOS = 'rv_usuarios';
  static CHAVE_SESSAO = 'rv_sessao';

  chaveDados(userId) {
    return `rv_dados_${userId}`;
  }

  lerUsuarios() {
    return JSON.parse(
      localStorage.getItem(
        BancoDados.CHAVE_USUARIOS
      ) || '[]'
    );
  }

  salvarUsuarios(usuarios) {
    localStorage.setItem(
      BancoDados.CHAVE_USUARIOS,
      JSON.stringify(usuarios)
    );
  }

  lerDados(userId) {
    const dados = localStorage.getItem(
      this.chaveDados(userId)
    );

    return dados ? JSON.parse(dados) : null;
  }

  salvarDados(userId, dados) {
    localStorage.setItem(
      this.chaveDados(userId),
      JSON.stringify(dados)
    );
  }

  salvarSessao(userId) {
    localStorage.setItem(
      BancoDados.CHAVE_SESSAO,
      userId
    );
  }

  lerSessao() {
    return localStorage.getItem(
      BancoDados.CHAVE_SESSAO
    );
  }

  limparSessao() {
    localStorage.removeItem(
      BancoDados.CHAVE_SESSAO
    );
  }

  dadosIniciais() {
    return {
      habitos: [],
      checkins: [],
      eventos: [],
      estado: {
        xp: 0,
        estagioPlanta: 0,
        falhasConsecutivas: 0,
        ultimaDataAvaliada:
          Util.somarDias(
            Util.chaveHoje(),
            -1
          )
      },
      config: {
        notificacoesGlobais: true
      }
    };
  }
}

/* =====================================================================
   AUTENTICAÇÃO
   ===================================================================== */
class Usuario {
  constructor({ id, nome, email, senha }) {
    this.id = id;
    this.nome = nome;
    this.email = email;
    this.senha = senha;
  }
}

class Autenticacao {
  constructor(banco) {
    this.banco = banco;
    this.garantirUsuarioDemo();
  }

  garantirUsuarioDemo() {
    const usuarios = this.banco.lerUsuarios();
    const existe = usuarios.some(u => u.email === 'demo@raizviva.com');

    if (!existe) {
      usuarios.push(new Usuario({
        id: Util.uid('u'),
        nome: 'Visitante',
        email: 'demo@raizviva.com',
        senha: '123456'
      }));

      this.banco.salvarUsuarios(usuarios);
    }
  }

  cadastrar({ nome, email, senha }) {
    nome = (nome || '').trim();
    email = (email || '').trim().toLowerCase();

    if (!nome || !email || !senha) {
      return {
        ok: false,
        erro: 'Preencha todos os campos.'
      };
    }

    if (senha.length < 4) {
      return {
        ok: false,
        erro: 'A senha deve ter ao menos 4 caracteres.'
      };
    }

    const usuarios = this.banco.lerUsuarios();

    if (usuarios.some(u => u.email === email)) {
      return {
        ok: false,
        erro: 'Já existe uma conta com este e-mail.'
      };
    }

    const usuario = new Usuario({
      id: Util.uid('u'),
      nome,
      email,
      senha
    });

    usuarios.push(usuario);
    this.banco.salvarUsuarios(usuarios);

    return {
      ok: true,
      usuario
    };
  }

  login({ email, senha }) {
    email = (email || '').trim().toLowerCase();

    const usuarios = this.banco.lerUsuarios();
    const usuario = usuarios.find(
      u => u.email === email && u.senha === senha
    );

    if (!usuario) {
      return {
        ok: false,
        erro: 'E-mail ou senha inválidos.'
      };
    }

    this.banco.salvarSessao(usuario.id);

    return {
      ok: true,
      usuario
    };
  }

  usuarioAtual() {
    const id = this.banco.lerSessao();

    if (!id) {
      return null;
    }

    const usuarios = this.banco.lerUsuarios();
    return usuarios.find(u => u.id === id) || null;
  }
}

/* =====================================================================
   APLICAÇÃO (camada de domínio, sem DOM)
   ===================================================================== */
class RaizVivaApp {
  constructor() {
    this.banco = new BancoDados();
    this.sessao = new Sessao(this.banco);

    this.pontuacao =
      new Pontuacao(this.sessao);

    this.narrativa =
      new Narrativa(this.sessao);

    this.habitos =
      new GerenciadorHabitos(this.sessao);

    this.checkins =
      new GerenciadorCheckins(
        this.sessao,
        this.habitos,
        this.pontuacao,
        this.narrativa
      );
  }

  iniciar(usuario) {
    this.sessao.iniciar(usuario);

    this.checkins.avaliarDiasPendentes?.();
  }

  logout() {
    this.banco.limparSessao();
    this.sessao.encerrar();
  }
}

const app = new RaizVivaApp();

/* =====================================================================
   INTERFACE — liga a camada de domínio (POO acima) ao HTML existente
   ===================================================================== */
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ICONES_HABITO = ['💧', '📚', '🏃', '🧘', '🍎', '😴', '✍️', '💪', '🎨', '🎯', '🧹', '💰'];
const CORES_HABITO = ['#FF69B4', '#CFFF04', '#C97B4A', '#4f8a5b', '#2B2B2B', '#386b43', '#d94f95', '#8fa093'];

class InterfaceApp {
  constructor(app) {
    this.app = app;
    this.abaAtual = 'dashboard';
    this.iconeSelecionado = null;
    this.corSelecionada = null;
  }

  $(id) {
    return document.getElementById(id);
  }

  init() {
    this.autenticacao = new Autenticacao(this.app.banco);

    this.wireAuth();
    this.wireNav();
    this.wireModalHabito();
    this.wireModalRetro();

    const usuario = this.autenticacao.usuarioAtual();

    if (usuario) {
      this.iniciarSessaoApp(usuario);
    }
  }

  /* ---------- autenticação ---------- */
  wireAuth() {
    this.$('form-login').addEventListener('submit', e => {
      e.preventDefault();

      const res = this.autenticacao.login({
        email: this.$('login-email').value,
        senha: this.$('login-senha').value
      });

      if (!res.ok) {
        this.$('erro-login').textContent = res.erro;
        return;
      }

      this.$('erro-login').textContent = '';
      this.$('form-login').reset();
      this.iniciarSessaoApp(res.usuario);
    });

    this.$('form-cadastro').addEventListener('submit', e => {
      e.preventDefault();

      const res = this.autenticacao.cadastrar({
        nome: this.$('cad-nome').value,
        email: this.$('cad-email').value,
        senha: this.$('cad-senha').value
      });

      if (!res.ok) {
        this.$('erro-cadastro').textContent = res.erro;
        return;
      }

      this.$('erro-cadastro').textContent = '';
      this.app.banco.salvarSessao(res.usuario.id);
      this.$('form-cadastro').reset();
      this.iniciarSessaoApp(res.usuario);
    });

    this.$('ir-cadastro').addEventListener('click', () => {
      this.$('erro-login').textContent = '';
      this.$('tela-login').classList.add('oculto');
      this.$('tela-cadastro').classList.remove('oculto');
    });

    this.$('ir-login').addEventListener('click', () => {
      this.$('erro-cadastro').textContent = '';
      this.$('tela-cadastro').classList.add('oculto');
      this.$('tela-login').classList.remove('oculto');
    });

    this.$('btn-logout').addEventListener('click', () => {
      this.app.logout();
      this.$('app').classList.add('oculto');
      this.$('tela-cadastro').classList.add('oculto');
      this.$('tela-login').classList.remove('oculto');
    });
  }

  iniciarSessaoApp(usuario) {
    this.app.iniciar(usuario);

    this.$('tela-login').classList.add('oculto');
    this.$('tela-cadastro').classList.add('oculto');
    this.$('app').classList.remove('oculto');

    this.$('saudacao-usuario').textContent = `Olá, ${usuario.nome.split(' ')[0]}!`;

    this.abaAtual = 'dashboard';
    this.mudarAba('dashboard');
  }

  /* ---------- navegação entre abas ---------- */
  wireNav() {
    document.querySelectorAll('nav.abas button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.abaAtual = btn.dataset.tela;
        this.mudarAba(btn.dataset.tela);
      });
    });
  }

  mudarAba(nomeTela) {
    document.querySelectorAll('nav.abas button').forEach(b => {
      b.classList.toggle('ativa', b.dataset.tela === nomeTela);
    });

    ['dashboard', 'mundo', 'habitos', 'estatisticas', 'config'].forEach(t => {
      this.$(`tela-${t}`).classList.toggle('oculto', t !== nomeTela);
    });

    this.renderizarAba(nomeTela);
  }

  renderizarAba(nome) {
    switch (nome) {
      case 'dashboard': this.renderizarDashboard(); break;
      case 'mundo': this.renderizarMundo(); break;
      case 'habitos': this.renderizarHabitos(); break;
      case 'estatisticas': this.renderizarEstatisticas(); break;
      case 'config': this.renderizarConfig(); break;
    }
  }

  /* ---------- utilitários de render ---------- */
  criarEstadoVazio(emoji, texto) {
    const div = document.createElement('div');
    div.className = 'vazio';

    const span = document.createElement('span');
    span.className = 'grande';
    span.textContent = emoji;

    const p = document.createElement('p');
    p.textContent = texto;

    div.append(span, p);
    return div;
  }

  mostrarToast(texto, tipo = 'positivo') {
    const zona = this.$('zona-toasts');

    const el = document.createElement('div');
    el.className = `toast ${tipo}`;

    const span = document.createElement('span');
    span.textContent = texto;

    const fech = document.createElement('button');
    fech.className = 'fech';
    fech.textContent = '✕';
    fech.addEventListener('click', () => el.remove());

    el.append(span, fech);
    zona.appendChild(el);

    setTimeout(() => el.remove(), 6000);
  }

  /* ---------- dashboard (check-in de hoje) ---------- */
  renderizarDashboard() {
    const estado = this.app.sessao.dados.estado;
    const estagio = Narrativa.ESTAGIOS[estado.estagioPlanta];
    const nivel = this.app.pontuacao.nivelAtual();
    const xp = this.app.pontuacao.xp;

    this.$('dash-emoji-planta').textContent = estagio.emoji;
    this.$('dash-nome-estagio').textContent = estagio.nome;
    this.$('dash-desc-estagio').textContent = estagio.desc;

    const faixa = nivel.max - nivel.min + 1;
    const progresso = ((xp - nivel.min) / faixa) * 100;
    this.$('dash-barra-xp').style.width = `${Math.min(100, Math.max(0, progresso))}%`;
    this.$('dash-xp-atual').textContent = `${xp} XP`;
    this.$('dash-xp-prox').textContent = `próx. ${nivel.max + 1} XP`;
    this.$('dash-nivel').textContent = `Nível ${nivel.nivel}`;
    this.$('pilula-xp-topo').textContent = `${xp} XP`;

    const avisoEl = this.$('dash-aviso-risco');
    avisoEl.innerHTML = '';

    if (estado.falhasConsecutivas > 0) {
      const div = document.createElement('div');
      div.className = 'aviso-risco';
      div.textContent = '⚠️ Sua planta está em risco — retome seus hábitos para não regredir de estágio.';
      avisoEl.appendChild(div);
    }

    this.renderizarListaCheckinHoje();
  }

  criarCartaoHabito(habito, { feito, aoClicar, retroativo = false }) {
    const div = document.createElement('div');
    div.className = `cartao-habito ${feito ? 'concluido' : ''}`;

    const icone = document.createElement('div');
    icone.className = 'icone-habito';
    icone.style.background = `${habito.cor}22`;
    icone.style.color = habito.cor;
    icone.textContent = habito.icone;

    const info = document.createElement('div');
    info.className = 'info-habito';

    const nome = document.createElement('div');
    nome.className = 'nome';
    nome.textContent = habito.nome;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = habito.meta || (habito.frequencia.tipo === 'diaria' ? 'Todos os dias' : 'Dias específicos');

    info.append(nome, meta);

    const streak = document.createElement('div');
    streak.className = 'badge-streak';
    streak.textContent = `🔥 ${habito.streak}`;

    const acoes = document.createElement('div');
    acoes.className = 'acoes-habito';

    const btn = document.createElement('button');
    btn.className = `btn-check ${feito ? 'feito' : ''}`;
    btn.type = 'button';
    btn.textContent = feito ? '✓' : (retroativo ? '↩' : '');
    btn.disabled = feito;
    btn.addEventListener('click', aoClicar);
    acoes.appendChild(btn);

    div.append(icone, info, streak, acoes);
    return div;
  }

  renderizarListaCheckinHoje() {
    const lista = this.$('lista-checkin-hoje');
    lista.innerHTML = '';

    const habitos = this.app.checkins.habitosDeHoje();

    if (habitos.length === 0) {
      lista.appendChild(this.criarEstadoVazio('🌤️', 'Nenhum hábito previsto para hoje.'));
      return;
    }

    habitos.forEach(h => {
      const feito = this.app.checkins.jaConcluiuHoje(h.id);
      lista.appendChild(this.criarCartaoHabito(h, {
        feito,
        aoClicar: () => this.fazerCheckinHoje(h.id)
      }));
    });
  }

  fazerCheckinHoje(id) {
    const res = this.app.checkins.fazerHoje(id);

    if (!res.ok) {
      this.mostrarToast(res.erro, 'negativo');
      return;
    }

    this.mostrarToast('✅ Check-in registrado! +10 XP', 'positivo');

    if (res.evolucao) {
      this.mostrarToast(`${res.evolucao.emoji} Sua plantinha evoluiu para "${res.evolucao.nome}"!`, 'positivo');
    }

    this.renderizarDashboard();
  }

  /* ---------- check-in retroativo ---------- */
  wireModalRetro() {
    this.$('btn-abrir-retro').addEventListener('click', () => this.abrirModalRetro());
    this.$('btn-fechar-retro').addEventListener('click', () => {
      this.$('modal-retro').classList.add('oculto');
    });
  }

  abrirModalRetro() {
    const lista = this.$('lista-retro');
    lista.innerHTML = '';

    const ontem = Util.chaveOntem();
    const candidatos = this.app.habitos
      .listarAtivos()
      .filter(h => h.preverPara(ontem));

    if (candidatos.length === 0) {
      lista.appendChild(this.criarEstadoVazio('🕰️', 'Nenhum hábito pendente de ontem.'));
    } else {
      candidatos.forEach(h => {
        const feito = !!this.app.checkins.buscar(h.id, ontem);
        lista.appendChild(this.criarCartaoHabito(h, {
          feito,
          retroativo: true,
          aoClicar: () => this.fazerCheckinRetro(h.id)
        }));
      });
    }

    this.$('modal-retro').classList.remove('oculto');
  }

  fazerCheckinRetro(id) {
    const res = this.app.checkins.fazerRetroativo(id);

    if (!res.ok) {
      this.mostrarToast(res.erro, 'negativo');
      return;
    }

    this.mostrarToast('✅ Check-in retroativo registrado! +10 XP', 'positivo');
    this.abrirModalRetro();
    this.renderizarDashboard();
  }

  /* ---------- meu mundo ---------- */
  renderizarMundo() {
    const estado = this.app.sessao.dados.estado;
    const estagio = Narrativa.ESTAGIOS[estado.estagioPlanta];

    this.$('mundo-emoji-planta').textContent = estagio.emoji;
    this.$('mundo-nome-estagio').textContent = estagio.nome;
    this.$('mundo-desc-estagio').textContent = estagio.desc;

    const trilha = this.$('mundo-trilha');
    trilha.innerHTML = '';

    Narrativa.ESTAGIOS.forEach((e, i) => {
      const span = document.createElement('span');
      span.className = 'marco-estagio';

      if (i < estado.estagioPlanta) span.classList.add('alcancado');
      if (i === estado.estagioPlanta) span.classList.add('atual');

      span.textContent = `${e.emoji} ${e.nome}`;
      trilha.appendChild(span);
    });

    const listaEv = this.$('lista-eventos');
    listaEv.innerHTML = '';

    const eventos = this.app.sessao.dados.eventos;

    if (eventos.length === 0) {
      listaEv.appendChild(this.criarEstadoVazio('📭', 'Nenhum evento registrado ainda.'));
      return;
    }

    eventos.forEach(ev => {
      const div = document.createElement('div');
      div.className = `item-evento ${ev.tipo}`;
      div.textContent = `${Util.formatarDataBR(ev.data)} — ${ev.texto}`;
      listaEv.appendChild(div);
    });
  }

  /* ---------- hábitos ---------- */
  renderizarHabitos() {
    const lista = this.$('lista-todos-habitos');
    lista.innerHTML = '';

    const habitos = this.app.habitos.listarAtivos();

    if (habitos.length === 0) {
      lista.appendChild(this.criarEstadoVazio('🌱', 'Você ainda não tem hábitos. Crie o primeiro!'));
      return;
    }

    habitos.forEach(h => {
      const div = document.createElement('div');
      div.className = 'cartao-habito';

      const icone = document.createElement('div');
      icone.className = 'icone-habito';
      icone.style.background = `${h.cor}22`;
      icone.style.color = h.cor;
      icone.textContent = h.icone;

      const info = document.createElement('div');
      info.className = 'info-habito';

      const nome = document.createElement('div');
      nome.className = 'nome';
      nome.textContent = h.nome;

      const meta = document.createElement('div');
      meta.className = 'meta';
      const freqTxt = h.frequencia.tipo === 'diaria'
        ? 'Todos os dias'
        : h.frequencia.dias.map(d => DIAS_SEMANA[d]).join(', ');
      meta.textContent = `${h.categoria} · ${freqTxt}${h.meta ? ' · ' + h.meta : ''}`;

      info.append(nome, meta);

      const streak = document.createElement('div');
      streak.className = 'badge-streak';
      streak.textContent = `🔥 ${h.streak} (melhor: ${h.melhorStreak})`;

      const acoes = document.createElement('div');
      acoes.className = 'acoes-habito';

      const btnEditar = document.createElement('button');
      btnEditar.type = 'button';
      btnEditar.className = 'botao botao-fantasma botao-peq';
      btnEditar.textContent = 'Editar';
      btnEditar.addEventListener('click', () => this.abrirModalHabito(h.id));
      acoes.appendChild(btnEditar);

      div.append(icone, info, streak, acoes);
      lista.appendChild(div);
    });
  }

  wireModalHabito() {
    this.$('btn-novo-habito').addEventListener('click', () => this.abrirModalHabito());
    this.$('btn-cancelar-habito').addEventListener('click', () => this.fecharModalHabito());

    this.$('habito-freq-tipo').addEventListener('change', e => {
      this.$('wrap-dias-semana').classList.toggle('oculto', e.target.value !== 'semanal');
    });

    this.$('form-habito').addEventListener('submit', e => {
      e.preventDefault();

      const id = this.$('habito-id').value;
      const diasSemana = Array.from(
        this.$('linha-dias-semana').querySelectorAll('.chip-dia.ativo')
      ).map(b => Number(b.dataset.dia));

      const dados = {
        nome: this.$('habito-nome').value,
        categoria: this.$('habito-categoria').value,
        meta: this.$('habito-meta').value,
        tipoFreq: this.$('habito-freq-tipo').value,
        diasSemana,
        icone: this.iconeSelecionado,
        cor: this.corSelecionada
      };

      const res = id
        ? this.app.habitos.editar(id, dados)
        : this.app.habitos.criar(dados);

      if (!res.ok) {
        this.$('erro-habito').textContent = res.erro;
        return;
      }

      this.fecharModalHabito();
      this.mostrarToast(id ? 'Hábito atualizado!' : 'Hábito criado! 🌱', 'positivo');
      this.renderizarAba(this.abaAtual);
    });

    this.$('btn-excluir-habito').addEventListener('click', () => {
      const id = this.$('habito-id').value;
      if (!id) return;

      if (!confirm('Deseja desativar este hábito? Ele deixará de aparecer nas suas listas.')) {
        return;
      }

      this.app.habitos.desativar(id);
      this.fecharModalHabito();
      this.mostrarToast('Hábito desativado.', 'aviso');
      this.renderizarAba(this.abaAtual);
    });
  }

  abrirModalHabito(id = null) {
    this.$('form-habito').reset();
    this.$('erro-habito').textContent = '';
    this.$('wrap-dias-semana').classList.add('oculto');

    if (id) {
      const h = this.app.habitos.buscarPorId(id);

      this.$('modal-habito-titulo').textContent = 'Editar hábito';
      this.$('habito-id').value = h.id;
      this.$('habito-nome').value = h.nome;
      this.$('habito-categoria').value = h.categoria;
      this.$('habito-meta').value = h.meta;
      this.$('habito-freq-tipo').value = h.frequencia.tipo;
      this.$('wrap-dias-semana').classList.toggle('oculto', h.frequencia.tipo !== 'semanal');

      this.renderizarLinhaDiasSemana(h.frequencia.dias || []);

      this.iconeSelecionado = h.icone;
      this.corSelecionada = h.cor;
      this.renderizarLinhaIcones();
      this.renderizarLinhaCores();

      this.$('btn-excluir-habito').style.display = 'inline-flex';
    } else {
      this.$('modal-habito-titulo').textContent = 'Novo hábito';
      this.$('habito-id').value = '';

      this.renderizarLinhaDiasSemana([]);

      this.iconeSelecionado = ICONES_HABITO[0];
      this.corSelecionada = CORES_HABITO[0];
      this.renderizarLinhaIcones();
      this.renderizarLinhaCores();

      this.$('btn-excluir-habito').style.display = 'none';
    }

    this.$('modal-habito').classList.remove('oculto');
  }

  fecharModalHabito() {
    this.$('modal-habito').classList.add('oculto');
  }

  renderizarLinhaDiasSemana(selecionados) {
    const linha = this.$('linha-dias-semana');
    linha.innerHTML = '';

    DIAS_SEMANA.forEach((label, idx) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip-dia ${selecionados.includes(idx) ? 'ativo' : ''}`;
      chip.textContent = label;
      chip.dataset.dia = idx;
      chip.addEventListener('click', () => chip.classList.toggle('ativo'));
      linha.appendChild(chip);
    });
  }

  renderizarLinhaIcones() {
    const linha = this.$('linha-icones');
    linha.innerHTML = '';

    ICONES_HABITO.forEach(icone => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `opcao-icone ${icone === this.iconeSelecionado ? 'sel' : ''}`;
      btn.textContent = icone;
      btn.addEventListener('click', () => {
        this.iconeSelecionado = icone;
        linha.querySelectorAll('.opcao-icone').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
      });
      linha.appendChild(btn);
    });
  }

  renderizarLinhaCores() {
    const linha = this.$('linha-cores');
    linha.innerHTML = '';

    CORES_HABITO.forEach(cor => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `opcao-cor ${cor === this.corSelecionada ? 'sel' : ''}`;
      btn.style.background = cor;
      btn.addEventListener('click', () => {
        this.corSelecionada = cor;
        linha.querySelectorAll('.opcao-cor').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
      });
      linha.appendChild(btn);
    });
  }

  /* ---------- estatísticas ---------- */
  calcularConclusao30Dias(habito) {
    let previstos = 0;
    let concluidos = 0;

    let cursor = Util.somarDias(Util.chaveHoje(), -29);
    const hoje = Util.chaveHoje();

    while (cursor <= hoje) {
      if (habito.preverPara(cursor)) {
        previstos++;

        if (this.app.checkins.buscar(habito.id, cursor)) {
          concluidos++;
        }
      }

      cursor = Util.somarDias(cursor, 1);
    }

    return { previstos, concluidos };
  }

  renderizarEstatisticas() {
    this.renderizarStatsHabitos();
    this.renderizarHeatmap();
    this.renderizarComparativo();
  }

  renderizarStatsHabitos() {
    const grade = this.$('grade-stats-habitos');
    grade.innerHTML = '';

    const habitos = this.app.habitos.listarAtivos();

    if (habitos.length === 0) {
      grade.appendChild(this.criarEstadoVazio('📊', 'Crie hábitos para ver estatísticas.'));
      return;
    }

    habitos.forEach(h => {
      const { previstos, concluidos } = this.calcularConclusao30Dias(h);
      const taxa = previstos > 0 ? Math.round((concluidos / previstos) * 100) : 0;

      const div = document.createElement('div');
      div.className = 'cartao stat-habito';

      const titulo = document.createElement('h4');
      titulo.textContent = `${h.icone} ${h.nome}`;
      div.appendChild(titulo);

      const linhas = [
        ['Streak atual', `${h.streak} dias`],
        ['Melhor streak', `${h.melhorStreak} dias`],
        ['Conclusão (30 dias)', `${taxa}% (${concluidos}/${previstos})`]
      ];

      linhas.forEach(([label, valor]) => {
        const linha = document.createElement('div');
        linha.className = 'stat-linha';

        const spanLabel = document.createElement('span');
        spanLabel.textContent = label;

        const b = document.createElement('b');
        b.textContent = valor;

        linha.append(spanLabel, b);
        div.appendChild(linha);
      });

      grade.appendChild(div);
    });
  }

  renderizarHeatmap() {
    const heat = this.$('heatmap-30');
    heat.innerHTML = '';

    const habitos = this.app.habitos.listarAtivos();

    let cursor = Util.somarDias(Util.chaveHoje(), -29);
    const hoje = Util.chaveHoje();

    while (cursor <= hoje) {
      const previstos = habitos.filter(h => h.preverPara(cursor));

      const div = document.createElement('div');
      div.className = 'dia-heat';
      div.title = Util.formatarDataBR(cursor);

      if (previstos.length === 0) {
        div.classList.add('futuro');
      } else {
        const todosFeitos = previstos.every(h => this.app.checkins.buscar(h.id, cursor));
        div.classList.add(todosFeitos ? 'ok' : 'falha');
      }

      heat.appendChild(div);
      cursor = Util.somarDias(cursor, 1);
    }
  }

  renderizarComparativo() {
    const wrap = this.$('barra-comparativo');
    wrap.innerHTML = '';

    const habitos = this.app.habitos.listarAtivos();

    if (habitos.length === 0) {
      wrap.appendChild(this.criarEstadoVazio('📈', 'Sem dados para comparar ainda.'));
      return;
    }

    habitos.forEach(h => {
      const { previstos, concluidos } = this.calcularConclusao30Dias(h);
      const pct = previstos > 0 ? Math.round((concluidos / previstos) * 100) : 0;

      const linha = document.createElement('div');
      linha.className = 'linha-barra';

      const rotulo = document.createElement('span');
      rotulo.className = 'rotulo';
      rotulo.textContent = h.nome;

      const trilho = document.createElement('div');
      trilho.className = 'trilho-barra';

      const preench = document.createElement('div');
      preench.className = 'preench-barra';
      preench.style.width = `${pct}%`;
      trilho.appendChild(preench);

      const valor = document.createElement('span');
      valor.className = 'valor-barra';
      valor.textContent = `${pct}%`;

      linha.append(rotulo, trilho, valor);
      wrap.appendChild(linha);
    });
  }

  /* ---------- configurações ---------- */
  renderizarConfig() {
    const config = this.app.sessao.dados.config;
    this.$('chk-notif-global').checked = config.notificacoesGlobais;

    this.$('chk-notif-global').onchange = () => {
      config.notificacoesGlobais = this.$('chk-notif-global').checked;
      this.app.sessao.salvar();
    };

    const lista = this.$('lista-config-habitos');
    lista.innerHTML = '';

    const habitos = this.app.habitos.listarAtivos();

    if (habitos.length === 0) {
      lista.appendChild(this.criarEstadoVazio('🔔', 'Crie hábitos para configurar lembretes.'));
      return;
    }

    habitos.forEach(h => {
      const linha = document.createElement('div');
      linha.className = 'linha-config';

      const nomeDiv = document.createElement('div');
      const nome = document.createElement('div');
      nome.className = 'nome';
      nome.textContent = `${h.icone} ${h.nome}`;
      nomeDiv.appendChild(nome);

      const hora = document.createElement('input');
      hora.type = 'time';
      hora.className = 'input-hora';
      hora.value = h.lembreteHora || '';

      const label = document.createElement('label');
      label.className = 'interruptor';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = h.lembreteAtivo;

      const trilha = document.createElement('span');
      trilha.className = 'trilha';

      label.append(chk, trilha);

      const salvar = () => {
        h.definirLembrete(hora.value, chk.checked);
        this.app.sessao.salvar();
      };

      hora.addEventListener('change', salvar);
      chk.addEventListener('change', salvar);

      linha.append(nomeDiv, hora, label);
      lista.appendChild(linha);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const interfaceApp = new InterfaceApp(app);
  interfaceApp.init();
});
