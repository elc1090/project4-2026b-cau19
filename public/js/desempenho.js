// ============================================================
// DESEMPENHO: números e gráficos (feitos só com CSS), calculados direto do banco
// ============================================================

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

async function init() {
  await initPage();
  const stats = await api('/api/stats');
  document.getElementById('stats').innerHTML = statTilesHtml(stats.totals);
  document.getElementById('disciplines').innerHTML = disciplineBarsHtml(stats.by_discipline);
  document.getElementById('evolution').innerHTML = evolutionHtml(stats.by_day);
  document.getElementById('history').innerHTML = historyTableHtml(stats.history);
}

init().catch(showPageError);
