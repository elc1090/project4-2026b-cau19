// ============================================================
// BANCO DE QUESTÕES: lista com filtros + tela de resolução + dúvidas com IA
// ============================================================
// A mesma página tem duas "telas": a lista (#list-view) e a resolução (#solve-view).
// Quando uma questão é aberta, a URL vira questoes.html?id=123 (dá para voltar e compartilhar o link).

const listView = document.getElementById('list-view');
const solveView = document.getElementById('solve-view');
const filtersForm = document.getElementById('filters');
const questionList = document.getElementById('question-list');
const listInfo = document.getElementById('list-info');
const questionCard = document.getElementById('question-card');
const doubtPanel = document.getElementById('doubt-panel');
const chat = document.getElementById('chat');
const doubtForm = document.getElementById('doubt-form');

let filterOptions = [];      // combinações {area, discipline, subject} vindas do servidor
let scope = 'all';           // 'all' | 'mine' | 'shared'
let listIds = [];            // ids da lista atual (para o botão "Próxima")
let currentQuestion = null;  // questão aberta na tela de resolução
let selectedLetter = null;   // alternativa escolhida (antes de responder)

// ============================================================
// FILTROS
// ============================================================
function fillSelect(select, values, placeholder) {
  const previous = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>`
    + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  if (values.includes(previous)) select.value = previous; // mantém a escolha, se ainda existir
}

function unique(values) {
  return [...new Set(values)];
}

// Selects "em cascata": a disciplina depende da área, e o assunto depende da disciplina
function updateFilterSelects() {
  const fields = filtersForm.elements;
  fillSelect(fields.area, unique(filterOptions.map((o) => o.area)), 'Área: todas');

  const byArea = filterOptions.filter((o) => !fields.area.value || o.area === fields.area.value);
  fillSelect(fields.discipline, unique(byArea.map((o) => o.discipline)), 'Disciplina: todas');

  const byDiscipline = byArea.filter((o) => !fields.discipline.value || o.discipline === fields.discipline.value);
  fillSelect(fields.subject, unique(byDiscipline.map((o) => o.subject)), 'Assunto: todos');
}

filtersForm.elements.area.addEventListener('change', () => { updateFilterSelects(); loadList(); });
filtersForm.elements.discipline.addEventListener('change', () => { updateFilterSelects(); loadList(); });
filtersForm.elements.subject.addEventListener('change', () => loadList());

filtersForm.addEventListener('submit', (event) => {
  event.preventDefault(); // não recarrega a página
  loadList();
});

document.getElementById('clear-filters').addEventListener('click', () => {
  filtersForm.reset();
  updateFilterSelects();
  loadList();
});

// Abas: Todas / Minhas / Compartilhadas (PRO)
document.querySelectorAll('[data-scope]').forEach((button) => {
  button.addEventListener('click', () => {
    scope = button.dataset.scope;
    document.querySelectorAll('[data-scope]').forEach((b) => b.classList.toggle('active', b === button));
    loadList();
  });
});

// ============================================================
// LISTA
// ============================================================
async function loadList() {
  questionList.innerHTML = '<p class="muted">Carregando...</p>';
  listInfo.textContent = '';

  // Monta a URL: /api/questions?scope=all&area=Direito&search=...
  const params = new URLSearchParams({ scope });
  for (const name of ['search', 'area', 'discipline', 'subject']) {
    const value = filtersForm.elements[name].value.trim();
    if (value) params.set(name, value);
  }

  try {
    const questions = await api(`/api/questions?${params}`);
    listIds = questions.map((q) => q.id);
    renderList(questions);
  } catch (error) {
    listIds = [];
    // 403 = o servidor recusou: banco compartilhado é só para PRO
    questionList.innerHTML = error.status === 403 ? proUpsellHtml(error) : `<p class="error">${escapeHtml(error.message)}</p>`;
  }
  updatePosition();
}

// A tela NÃO esconde a aba "Compartilhadas" de quem é gratuito: ela pede os dados ao servidor
// e mostra a recusa que ele devolve. Assim fica visível que quem bloqueia é o backend.
function proUpsellHtml(error) {
  return `
    <div class="card upsell">
      <span class="badge badge-pro">PRO</span>
      <h2>O banco compartilhado é exclusivo do plano PRO</h2>
      <p class="server-denied" title="${escapeHtml(error.message)}">🔒 Acesso negado pelo servidor · <code>HTTP ${error.status}</code></p>
      <p class="muted">Com o PRO você resolve as questões que outros usuários compartilham com a comunidade. A assinatura é demonstrativa: nenhuma cobrança é feita.</p>
      <a class="btn btn-primary" href="/perfil.html">Assinar PRO</a>
    </div>`;
}

function renderList(questions) {
  if (questions.length === 0) {
    questionList.innerHTML = `
      <div class="card empty">
        <p class="empty-icon">🔎</p>
        <p><strong>Nenhuma questão encontrada.</strong></p>
        <p>Mude os filtros ou cadastre uma questão nova.</p>
        <a class="btn btn-primary" href="/adicionar.html">Adicionar questão</a>
      </div>`;
    return;
  }

  listInfo.textContent = questions.length === 100
    ? 'Mostrando as 100 mais recentes. Use os filtros para refinar.'
    : `${questions.length} ${questions.length === 1 ? 'questão encontrada' : 'questões encontradas'}`;

  questionList.innerHTML = questions.map((q) => `
    <article class="card q-card">
      <p class="q-meta">${classificationHtml(q)}</p>
      <p class="q-preview">${escapeHtml(q.statement_preview)}</p>
      <div class="q-footer">
        ${authorBadgeHtml(q)}
        ${q.is_shared ? '<span class="badge badge-shared">Compartilhada</span>' : ''}
        ${q.source ? `<span class="badge">${escapeHtml(q.source)}</span>` : ''}
        ${q.has_answer_key ? '' : '<span class="badge badge-warn">Sem gabarito</span>'}
        ${q.last_result === true ? '<span class="badge badge-ok">✓ Você acertou</span>' : ''}
        ${q.last_result === false ? '<span class="badge badge-wrong">✗ Você errou</span>' : ''}
        <div class="actions"><button type="button" class="btn btn-primary btn-small" data-open="${q.id}">Resolver</button></div>
      </div>
    </article>`).join('');
}

questionList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open]');
  if (button) openQuestion(Number(button.dataset.open));
});

// ============================================================
// RESOLUÇÃO
// ============================================================
async function openQuestion(id, updateUrl = true) {
  listView.hidden = true;
  solveView.hidden = false;
  doubtPanel.hidden = true;
  chat.innerHTML = '';
  questionCard.innerHTML = '<p class="muted">Carregando...</p>';
  window.scrollTo(0, 0);
  if (updateUrl) history.pushState({}, '', `/questoes.html?id=${id}`);

  try {
    currentQuestion = await api(`/api/questions/${id}`);
  } catch (error) {
    currentQuestion = null;
    questionCard.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
    updatePosition();
    return;
  }
  renderQuestion();
  updatePosition();
  loadDoubts();
}

function renderQuestion() {
  const q = currentQuestion;
  selectedLetter = null;
  questionCard.innerHTML = `
    <p class="q-meta">${classificationHtml(q)}</p>
    <div class="q-badges">
      ${authorBadgeHtml(q)}
      ${q.is_shared ? '<span class="badge badge-shared">Compartilhada</span>' : ''}
      ${q.source ? `<span class="badge">${escapeHtml(q.source)}</span>` : ''}
      ${q.has_answer_key ? '' : '<span class="badge badge-warn">Sem gabarito</span>'}
    </div>
    <div class="q-statement">${escapeHtml(q.statement)}</div>
    <div class="alts">
      ${q.alternatives.map((alt) => `
        <button type="button" class="alt" data-letter="${alt.letter}">
          <span class="alt-letter">${alt.letter}</span>
          <span class="alt-text">${escapeHtml(alt.text)}</span>
        </button>`).join('')}
    </div>
    <div id="answer-result"></div>
    <div class="q-actions">
      <button type="button" class="btn btn-primary" id="confirm-button" disabled>Responder</button>
      <button type="button" class="btn" id="ask-ai-button">Perguntar à IA</button>
    </div>`;
}

// Um único "ouvinte" de cliques para todos os botões do cartão da questão
questionCard.addEventListener('click', (event) => {
  const alt = event.target.closest('.alt');
  if (alt && !alt.disabled) {
    selectedLetter = alt.dataset.letter;
    questionCard.querySelectorAll('.alt').forEach((a) => a.classList.toggle('selected', a === alt));
    document.getElementById('confirm-button').disabled = false;
    return;
  }

  const target = event.target.closest('button');
  if (!target) return;
  if (target.id === 'confirm-button') submitAnswer(target);
  if (target.id === 'retry-button') renderQuestion();
  if (target.id === 'explanation-button') {
    const explanation = document.getElementById('explanation');
    explanation.hidden = !explanation.hidden;
    target.textContent = explanation.hidden ? 'Ver explicação' : 'Esconder explicação';
  }
  if (target.id === 'ask-ai-button') {
    doubtPanel.hidden = false;
    doubtPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    doubtForm.elements.message.focus({ preventScroll: true });
  }
});

// Envia a resposta. Quem corrige é o SERVIDOR (o navegador nem conhece o gabarito antes disso).
async function submitAnswer(button) {
  button.disabled = true;
  button.textContent = 'Corrigindo...';
  try {
    const result = await api(`/api/questions/${currentQuestion.id}/answer`, {
      method: 'POST',
      body: { letter: selectedLetter },
    });
    showAnswerResult(result, button);
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Responder';
    document.getElementById('answer-result').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function showAnswerResult(result, button) {
  // Pinta as alternativas: a certa de verde e a escolhida (se errada) de vermelho
  questionCard.querySelectorAll('.alt').forEach((alt) => {
    alt.disabled = true;
    alt.classList.remove('selected');
    if (alt.dataset.letter === result.correct_letter) alt.classList.add('correct');
    else if (alt.dataset.letter === selectedLetter && result.is_correct === false) alt.classList.add('wrong');
    else if (alt.dataset.letter === selectedLetter) alt.classList.add('selected');
  });

  let html;
  if (!result.has_answer_key) {
    html = '<div class="result neutral">Esta questão não tem gabarito informado, então a resposta não foi corrigida nem entrou nas suas estatísticas.</div>';
  } else if (result.is_correct) {
    html = '<div class="result ok">✓ Resposta correta!</div>';
  } else {
    html = `<div class="result bad">✗ Resposta incorreta. O gabarito é a letra ${result.correct_letter}.</div>`;
  }

  if (result.explanation) {
    html += `
      <div class="explanation-area">
        <button type="button" class="btn btn-small" id="explanation-button">Ver explicação</button>
        <div class="explanation" id="explanation" hidden>${escapeHtml(result.explanation)}</div>
      </div>`;
  } else {
    html += '<p class="muted small">Esta questão não tem explicação cadastrada. Use "Perguntar à IA" para entender melhor.</p>';
  }
  document.getElementById('answer-result').innerHTML = html;

  button.id = 'retry-button';
  button.textContent = 'Responder de novo';
  button.disabled = false;
  button.classList.remove('btn-primary');
}

// "Questão 3 de 20" e o botão "Próxima"
function updatePosition() {
  const position = document.getElementById('solve-position');
  const nextButton = document.getElementById('next-button');
  const index = currentQuestion ? listIds.indexOf(currentQuestion.id) : -1;
  position.textContent = index >= 0 ? `Questão ${index + 1} de ${listIds.length}` : '';
  nextButton.disabled = index < 0 || index >= listIds.length - 1;
}

document.getElementById('next-button').addEventListener('click', () => {
  const index = listIds.indexOf(currentQuestion?.id);
  if (index >= 0 && index < listIds.length - 1) openQuestion(listIds[index + 1]);
});

function showList(updateUrl) {
  solveView.hidden = true;
  listView.hidden = false;
  currentQuestion = null;
  if (updateUrl) history.pushState({}, '', '/questoes.html');
  loadList(); // recarrega para atualizar os selos "Você acertou/errou"
}

document.getElementById('back-button').addEventListener('click', () => showList(true));

// Botões "voltar/avançar" do navegador
window.addEventListener('popstate', () => {
  const id = Number(new URLSearchParams(window.location.search).get('id'));
  if (id) openQuestion(id, false);
  else showList(false);
});

// ============================================================
// DÚVIDAS COM IA
// ============================================================
function appendMessage(role, html) {
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  div.innerHTML = html;
  chat.appendChild(div);
  return div;
}

// Mostra as dúvidas que o usuário já fez sobre esta questão
async function loadDoubts() {
  const questionId = currentQuestion.id;
  try {
    const doubts = await api(`/api/questions/${questionId}/doubts`);
    if (currentQuestion?.id !== questionId) return; // o usuário já mudou de questão
    for (const doubt of doubts) {
      appendMessage('user', escapeHtml(doubt.user_message));
      appendMessage('ai', formatAiText(doubt.ai_response));
    }
    if (doubts.length > 0) doubtPanel.hidden = false;
  } catch (error) {
    // sem histórico de dúvidas: não atrapalha a resolução
  }
}

doubtForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = doubtForm.elements.message.value.trim();
  if (!message || !currentQuestion) return;

  const submitButton = doubtForm.querySelector('button');
  submitButton.disabled = true;
  appendMessage('user', escapeHtml(message));
  const reply = appendMessage('ai', '<span class="muted"><span class="spinner"></span> A IA está pensando... (pode levar até 1 minuto)</span>');
  doubtForm.reset();

  try {
    const result = await api(`/api/questions/${currentQuestion.id}/doubts`, {
      method: 'POST',
      body: { message },
    });
    reply.innerHTML = formatAiText(result.ai_response);
  } catch (error) {
    reply.classList.add('msg-error');
    reply.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    reply.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

// Enter envia; Shift+Enter quebra a linha
doubtForm.elements.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    doubtForm.requestSubmit();
  }
});

// ============================================================
// INÍCIO
// ============================================================
async function init() {
  await initPage();
  filterOptions = await api('/api/questions/filters');
  updateFilterSelects();

  // Veio de um link direto (ex.: questoes.html?id=12)? Abre a questão já.
  const id = Number(new URLSearchParams(window.location.search).get('id'));
  const listLoading = loadList(); // a lista carrega junto (para o botão "Próxima" funcionar)
  if (id) await openQuestion(id, false);
  await listLoading;
}

init().catch(showPageError);
