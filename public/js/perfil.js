// ============================================================
// PERFIL: dados do usuário, plano (assinatura demonstrativa) e botão de sair
// ============================================================

const freeCard = document.getElementById('plan-free');
const proCard = document.getElementById('plan-pro');
const proDialog = document.getElementById('pro-dialog');
const planMessage = document.getElementById('plan-message');

function renderProfile(user) {
  document.getElementById('profile').innerHTML = `
    <div class="profile-head">
      ${avatarHtml(user, 'avatar avatar-lg')}
      <div>
        <h2>${escapeHtml(user.name)}</h2>
        <p class="muted">${escapeHtml(user.email)}</p>
        <p class="muted small">Membro desde ${formatDate(user.created_at)} · Plano atual: ${planBadgeHtml(user.plan)}</p>
      </div>
    </div>`;
}

// Destaca o plano atual e mostra o botão certo em cada cartão
function renderPlans(user) {
  const isPro = user.plan === 'pro';
  freeCard.classList.toggle('current', !isPro);
  proCard.classList.toggle('current', isPro);
  document.querySelectorAll('.current-tag').forEach((tag) => tag.remove());
  (isPro ? proCard : freeCard).insertAdjacentHTML('afterbegin', '<span class="current-tag">Seu plano</span>');

  document.getElementById('plan-free-action').innerHTML = isPro
    ? '<button type="button" class="btn" data-plan="free">Voltar ao plano gratuito</button>'
    : '';
  document.getElementById('plan-pro-action').innerHTML = isPro
    ? '<a class="btn" href="/questoes.html">Ver questões compartilhadas →</a>'
    : '<button type="button" class="btn btn-primary" data-plan="pro">Assinar PRO</button><p class="muted small">Demonstração: nenhuma cobrança é feita.</p>';
}

function showPlanMessage(html, type = '') {
  planMessage.className = `notice ${type}`;
  planMessage.innerHTML = html;
  planMessage.hidden = false;
}

// Pede ao servidor para trocar o plano. O servidor só muda o plano do próprio usuário logado.
async function changePlan(plan) {
  try {
    currentUser = await api('/api/me/plan', { method: 'PUT', body: { plan } });
    renderHeader();
    renderProfile(currentUser);
    renderPlans(currentUser);
    if (plan === 'pro') {
      showPlanMessage('Pronto! Sua conta agora é <strong>PRO</strong> (demonstração). <a href="/questoes.html">Ver o banco compartilhado →</a>');
    } else {
      showPlanMessage('Sua conta voltou para o plano gratuito.');
    }
  } catch (error) {
    showPlanMessage(escapeHtml(error.message), 'notice-error');
  }
}

// Cliques nos botões dos cartões de plano
document.getElementById('plans').addEventListener('click', (event) => {
  const button = event.target.closest('[data-plan]');
  if (!button) return;

  if (button.dataset.plan === 'pro') {
    proDialog.returnValue = ''; // limpa a escolha anterior (Esc fecha sem mudar este valor)
    proDialog.showModal();
  } else if (confirm('Voltar ao plano gratuito? Você deixa de ver as questões compartilhadas por outros usuários.')) {
    changePlan('free');
  }
});

// A janela fecha com o valor do botão clicado: "confirm" ou "cancel"
proDialog.addEventListener('close', () => {
  if (proDialog.returnValue === 'confirm') changePlan('pro');
});

// Sair: o servidor apaga o cookie do crachá e voltamos para a tela de login
document.getElementById('logout-button').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

async function loadProfile() {
  const user = await initPage();
  renderProfile(user);
  renderPlans(user);
}

loadProfile().catch(showPageError);
