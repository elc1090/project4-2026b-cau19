// ============================================================
// COMMON: funções usadas por todas as páginas (carregado ANTES do JS de cada página)
// ============================================================
// Lembrete de segurança: esconder botões aqui é só conforto visual.
// Quem decide o que cada usuário pode ver ou fazer é SEMPRE o servidor.

const LOGO_SVG = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor"/><path d="M9.5 16.5l4.3 4.3 8.7-9.3" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

let currentUser = null; // dados do usuário logado (vem de GET /api/me)

// Faz um pedido para a API do nosso servidor e devolve a resposta já em JSON.
// O cookie de login vai junto automaticamente (mesmo site). Se der erro, lança um Error
// com a mensagem do servidor e o status HTTP (error.status).
async function api(path, { method = 'GET', body } = {}) {
  const options = { method, headers: {} };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const res = await fetch(path, options);
  const data = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    // 401 = não está logado (ou o login expirou): volta para a tela de login
    if (res.status === 401) {
      window.location.href = '/?erro=sessao';
    }
    const error = new Error(data?.error || `Erro ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return data;
}

// Evita que textos vindos do servidor virem HTML (proteção contra XSS).
// Essencial aqui: questões compartilhadas trazem textos escritos por OUTRAS pessoas.
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('pt-BR');
}

function formatDateTime(isoDate) {
  return new Date(isoDate).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function firstName(name) {
  return String(name || '').split(' ')[0];
}

// Foto do Google, ou a inicial do nome se não houver foto
function avatarHtml(user, className = 'avatar') {
  if (user.picture_url) {
    // no-referrer: as fotos do Google às vezes não carregam sem isso
    return `<img class="${className}" src="${escapeHtml(user.picture_url)}" alt="" referrerpolicy="no-referrer" />`;
  }
  return `<span class="${className} avatar-fallback">${escapeHtml(firstName(user.name).charAt(0).toUpperCase())}</span>`;
}

function planBadgeHtml(plan) {
  return plan === 'pro' ? '<span class="badge badge-pro">PRO</span>' : '<span class="badge">Gratuito</span>';
}

// Área › Disciplina › Assunto › Subassunto
function classificationHtml(q) {
  return [q.area, q.discipline, q.subject, q.subsubject]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<span class="sep">›</span>');
}

function authorBadgeHtml(q) {
  return q.is_mine
    ? '<span class="badge">Sua questão</span>'
    : `<span class="badge">Por ${escapeHtml(q.author_name)}</span>`;
}

// ------------------------------------------------------------
// Cabeçalho com o menu (o mesmo em todas as páginas)
// ------------------------------------------------------------
const NAV_LINKS = [
  { page: 'dashboard', href: '/dashboard.html', label: 'Início' },
  { page: 'questoes', href: '/questoes.html', label: 'Banco de questões' },
  { page: 'adicionar', href: '/adicionar.html', label: 'Adicionar questão' },
  { page: 'minhas', href: '/minhas-questoes.html', label: 'Minhas questões' },
  { page: 'desempenho', href: '/desempenho.html', label: 'Desempenho' },
];

function renderHeader() {
  const page = document.body.dataset.page; // ex.: <body data-page="dashboard">
  document.getElementById('topbar').innerHTML = `
    <div class="topbar-inner">
      <a class="brand" href="/dashboard.html">${LOGO_SVG}<span>Gabarito</span></a>
      <nav class="nav" aria-label="Menu principal">
        ${NAV_LINKS.map((link) => `<a href="${link.href}" class="${link.page === page ? 'active' : ''}">${link.label}</a>`).join('')}
      </nav>
      <a class="user-chip ${page === 'perfil' ? 'active' : ''}" href="/perfil.html" title="Meu perfil">
        ${avatarHtml(currentUser)}
        <span class="user-name">${escapeHtml(firstName(currentUser.name))}</span>
        ${planBadgeHtml(currentUser.plan)}
      </a>
    </div>`;
}

// Toda página logada começa assim: descobre quem é o usuário e desenha o cabeçalho.
// Se não houver login, api() leva de volta para a tela de login.
async function initPage() {
  currentUser = await api('/api/me');
  renderHeader();
  return currentUser;
}

// Mostra um erro no lugar do conteúdo da página
function showPageError(error) {
  if (error.status === 401) return; // já está indo para a tela de login
  document.querySelector('main').innerHTML = `
    <div class="card empty">
      <p class="empty-icon">⚠️</p>
      <p><strong>Não foi possível carregar esta página.</strong></p>
      <p>${escapeHtml(error.message)}</p>
      <a class="btn" href="/dashboard.html">Voltar ao início</a>
    </div>`;
}

// ------------------------------------------------------------
// Pedaços de tela usados no Início e no Desempenho
// ------------------------------------------------------------
function percentClass(percent) {
  if (percent >= 70) return 'good';
  if (percent >= 50) return 'mid';
  return 'low';
}

function statTilesHtml(totals) {
  const percentText = totals.percent === null ? '–' : `${totals.percent}%`;
  const percentBar = totals.percent === null ? ''
    : `<div class="bar"><span class="bar-fill ${percentClass(totals.percent)}" style="width:${totals.percent}%"></span></div>`;
  return `
    <div class="stats-grid">
      <div class="stat"><span class="stat-label">Questões resolvidas</span><span class="stat-value">${totals.questions}</span><span class="stat-hint">${totals.total} ${totals.total === 1 ? 'resposta' : 'respostas'} no total</span></div>
      <div class="stat stat-ok"><span class="stat-label">Acertos</span><span class="stat-value">${totals.correct}</span></div>
      <div class="stat stat-wrong"><span class="stat-label">Erros</span><span class="stat-value">${totals.wrong}</span></div>
      <div class="stat"><span class="stat-label">Aproveitamento</span><span class="stat-value">${percentText}</span>${percentBar}</div>
    </div>`;
}

// Barras horizontais: a largura da barra é o percentual de acertos
function disciplineBarsHtml(rows) {
  if (rows.length === 0) {
    return '<p class="muted">Responda algumas questões para ver seu desempenho por disciplina.</p>';
  }
  return `<div class="bars">${rows.map((row) => `
    <div>
      <div class="bar-label">
        <span>${escapeHtml(row.discipline)}</span>
        <span class="muted small">${row.correct}/${row.total} · <strong>${row.percent}%</strong></span>
      </div>
      <div class="bar"><span class="bar-fill ${percentClass(row.percent)}" style="width:${row.percent}%"></span></div>
    </div>`).join('')}</div>`;
}

function historyListHtml(rows) {
  if (rows.length === 0) {
    return '<p class="muted">Nenhuma resposta ainda. <a href="/questoes.html">Resolva sua primeira questão</a>.</p>';
  }
  return `<ul class="history">${rows.map((item) => `
    <li>
      <span class="badge ${item.is_correct ? 'badge-ok' : 'badge-wrong'}">${item.is_correct ? 'Acertou' : 'Errou'}</span>
      <a class="history-text" href="/questoes.html?id=${item.question_id}">${escapeHtml(item.statement_preview)}</a>
      <span class="muted small">${escapeHtml(item.discipline)} · ${formatDateTime(item.answered_at)}</span>
    </li>`).join('')}</ul>`;
}

// Formata o texto da IA com segurança: primeiro escapa o HTML, depois converte
// **negrito**, *itálico* e linhas começando com "- " em lista. Todo o resto vira parágrafo.
function formatAiText(text) {
  const lines = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // *itálico*: o asterisco precisa estar colado na palavra (assim "* item" de lista não vira itálico)
    .replace(/(^|[^*\w])\*(\S(?:[^*\n]*?\S)?)\*(?![*\w])/g, '$1<em>$2</em>')
    .split('\n');
  let html = '';
  let inList = false;
  for (const line of lines) {
    const item = line.match(/^\s*[-*•]\s+(.*)$/);
    if (item) {
      if (!inList) html += '<ul>';
      inList = true;
      html += `<li>${item[1]}</li>`;
      continue;
    }
    if (inList) html += '</ul>';
    inList = false;
    if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}
