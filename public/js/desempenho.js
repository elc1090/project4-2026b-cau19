// ============================================================
// DESEMPENHO: números, gráficos (feitos só com CSS) e análise com IA
// ============================================================

const analysisBox = document.getElementById('analysis');
const analysisButton = document.getElementById('analysis-button');
const analysisError = document.getElementById('analysis-error');

// "2026-11-22" no horário local (o servidor agrupa os dias no horário de Brasília)
function dayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function shortDate(date) {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// Gráfico de colunas: uma coluna por dia; a altura é a quantidade de respostas,
// verde = acertos, vermelho = erros. Dias sem resposta ficam vazios.
function evolutionHtml(byDay) {
  if (byDay.length === 0) {
    return '<p class="muted">Nenhuma resposta nos últimos 30 dias.</p>';
  }
  const answersByDay = new Map(byDay.map((d) => [d.day, d]));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const data = answersByDay.get(dayKey(date)) || { total: 0, correct: 0 };
    days.push({ date, total: data.total, correct: data.correct });
  }
  const max = Math.max(...days.map((d) => d.total));

  const columns = days.map((d) => {
    const wrong = d.total - d.correct;
    return `
      <div class="col" title="${shortDate(d.date)}: ${d.correct} acerto(s) e ${wrong} erro(s)">
        <span class="col-wrong" style="height:${(wrong / max) * 100}%"></span>
        <span class="col-correct" style="height:${(d.correct / max) * 100}%"></span>
      </div>`;
  }).join('');

  // Mostra a data a cada 5 dias, para não amontoar
  const labels = days.map((d, i) => `<span>${i % 5 === 0 ? shortDate(d.date) : ''}</span>`).join('');

  return `
    <div class="chart-columns">${columns}</div>
    <div class="chart-labels">${labels}</div>
    <div class="legend"><span><i class="dot ok"></i>Acertos</span><span><i class="dot bad"></i>Erros</span></div>`;
}

function historyTableHtml(rows) {
  if (rows.length === 0) {
    return '<p class="muted">Nenhuma resposta ainda. <a href="/questoes.html">Resolva sua primeira questão</a>.</p>';
  }
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Data</th><th>Questão</th><th>Disciplina</th><th>Marcou</th><th>Resultado</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${formatDateTime(row.answered_at)}</td>
              <td><a href="/questoes.html?id=${row.question_id}">${escapeHtml(row.statement_preview)}</a></td>
              <td>${escapeHtml(row.discipline)}</td>
              <td>${row.selected_letter}</td>
              <td><span class="badge ${row.is_correct ? 'badge-ok' : 'badge-wrong'}">${row.is_correct ? 'Acertou' : 'Errou'}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// ------------------------------------------------------------
// Análise com IA
// ------------------------------------------------------------
function renderAnalysis(data) {
  if (!data.analysis) {
    analysisBox.innerHTML = '<p class="muted">Você ainda não gerou uma análise. Responda pelo menos 5 questões com gabarito e clique em "Gerar análise".</p>';
    return;
  }
  const a = data.analysis;
  const block = (title, items, className) => (items.length === 0 ? '' : `
    <div class="analysis-block ${className}">
      <h3>${title}</h3>
      <ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    </div>`);

  analysisBox.innerHTML = `
    <p class="analysis-summary">${escapeHtml(a.summary)}</p>
    <div class="analysis-grid">
      ${block('Pontos fortes', a.strengths, 'good')}
      ${block('Dificuldades', a.difficulties, 'low')}
      ${block('Assuntos que precisam de atenção', a.attention_subjects, 'mid')}
      ${block('Sugestões de estudo', a.study_tips, 'tips')}
    </div>
    <p class="muted small">Gerada em ${formatDateTime(data.created_at)} a partir das suas respostas registradas. A IA pode errar: use como orientação.</p>`;
  analysisButton.textContent = 'Gerar nova análise';
}

analysisButton.addEventListener('click', async () => {
  analysisButton.disabled = true;
  analysisError.hidden = true;
  const previousText = analysisButton.textContent;
  analysisButton.innerHTML = '<span class="spinner"></span> Analisando...';
  try {
    const data = await api('/api/stats/analysis', { method: 'POST' });
    renderAnalysis(data);
  } catch (error) {
    analysisError.textContent = error.message;
    analysisError.hidden = false;
    analysisButton.textContent = previousText;
  } finally {
    analysisButton.disabled = false;
  }
});

async function init() {
  await initPage();
  const stats = await api('/api/stats');
  document.getElementById('stats').innerHTML = statTilesHtml(stats.totals);
  document.getElementById('disciplines').innerHTML = disciplineBarsHtml(stats.by_discipline);
  document.getElementById('evolution').innerHTML = evolutionHtml(stats.by_day);
  document.getElementById('history').innerHTML = historyTableHtml(stats.history);

  renderAnalysis(await api('/api/stats/analysis'));
}

init().catch(showPageError);
