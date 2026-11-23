// ============================================================
// MINHAS QUESTÕES: as questões que EU cadastrei, com editar e excluir
// ============================================================

const listBox = document.getElementById('my-questions');
const countText = document.getElementById('count');
const pageError = document.getElementById('page-error');
let questions = [];

function updateCount() {
  const total = questions.length;
  const shared = questions.filter((q) => q.is_shared).length;
  countText.textContent = total === 0
    ? 'Você ainda não cadastrou questões.'
    : `${total} ${total === 1 ? 'questão cadastrada' : 'questões cadastradas'} · ${shared} compartilhada${shared === 1 ? '' : 's'}`;
}

function render() {
  updateCount();
  if (questions.length === 0) {
    listBox.innerHTML = `
      <div class="card empty">
        <p class="empty-icon">🗂️</p>
        <p><strong>Nenhuma questão por aqui ainda.</strong></p>
        <p>Envie o print de uma questão e a IA organiza para você.</p>
        <a class="btn btn-primary" href="/adicionar.html">Adicionar a primeira</a>
      </div>`;
    return;
  }

  listBox.innerHTML = questions.map((q) => `
    <article class="card q-card">
      <p class="q-meta">${classificationHtml(q)}</p>
      <p class="q-preview">${escapeHtml(q.statement_preview)}</p>
      <div class="q-footer">
        ${q.is_shared ? '<span class="badge badge-shared">Compartilhada</span>' : '<span class="badge">Particular</span>'}
        ${q.has_answer_key ? '' : '<span class="badge badge-warn">Sem gabarito</span>'}
        <span class="muted small">Cadastrada em ${formatDate(q.created_at)} · ${q.answer_count} ${q.answer_count === 1 ? 'resposta' : 'respostas'}</span>
        <div class="actions">
          <a class="btn btn-small" href="/questoes.html?id=${q.id}">Resolver</a>
          <a class="btn btn-small" href="/adicionar.html?editar=${q.id}">Editar</a>
          <button type="button" class="btn btn-small btn-danger" data-delete="${q.id}">Excluir</button>
        </div>
      </div>
    </article>`).join('');
}

// Excluir (o servidor só apaga se a questão for mesmo sua)
listBox.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  if (!confirm('Excluir esta questão? As respostas registradas para ela também serão apagadas.')) return;

  const id = Number(button.dataset.delete);
  button.disabled = true;
  pageError.hidden = true;
  try {
    await api(`/api/questions/${id}`, { method: 'DELETE' });
    questions = questions.filter((q) => q.id !== id);
    render();
  } catch (error) {
    button.disabled = false;
    pageError.textContent = error.message;
    pageError.hidden = false;
  }
});

async function init() {
  await initPage();
  questions = await api('/api/me/questions');
  render();
}

init().catch(showPageError);
