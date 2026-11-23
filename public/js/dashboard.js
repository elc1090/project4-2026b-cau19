// ============================================================
// INÍCIO (dashboard): resumo do desempenho e atalhos
// ============================================================

async function loadDashboard() {
  const user = await initPage();
  document.getElementById('greeting').textContent = `Olá, ${firstName(user.name)}!`;

  if (user.plan !== 'pro') {
    document.getElementById('pro-banner').innerHTML = `
      <div class="notice notice-pro">
        <span class="badge badge-pro">PRO</span>
        <span>Com o plano PRO você também resolve as questões que outros usuários compartilham.</span>
        <a href="/perfil.html">Assinar PRO (demonstração) →</a>
      </div>`;
  }

  // Estatísticas calculadas pelo servidor a partir das respostas gravadas no banco
  const stats = await api('/api/stats');
  document.getElementById('stats').innerHTML = statTilesHtml(stats.totals);
  document.getElementById('disciplines').innerHTML = disciplineBarsHtml(stats.by_discipline.slice(0, 5));
  document.getElementById('recent').innerHTML = historyListHtml(stats.history.slice(0, 5));
}

loadDashboard().catch(showPageError);
