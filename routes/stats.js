// ============================================================
// ROTAS DE DESEMPENHO: estatísticas e análise com IA
// ============================================================
// Tudo aqui usa só as respostas do PRÓPRIO usuário (WHERE user_id = req.user.id).

const express = require('express');
const pool = require('../database');
const { requireAuth } = require('../auth');
const ai = require('../ai');

const router = express.Router();
const MIN_ANSWERS_FOR_ANALYSIS = 5;

function percent(correct, total) {
  return total > 0 ? Math.round((correct * 100) / total) : null;
}

// Totais gerais: respostas, acertos, questões diferentes
async function getTotals(userId) {
  const result = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE is_correct)::int AS correct,
            count(DISTINCT question_id)::int AS questions
     FROM answers WHERE user_id = $1`,
    [userId]
  );
  const { total, correct, questions } = result.rows[0];
  return { total, correct, wrong: total - correct, questions, percent: percent(correct, total) };
}

// Acertos por disciplina
async function getByDiscipline(userId) {
  const result = await pool.query(
    `SELECT q.area, q.discipline,
            count(*)::int AS total,
            count(*) FILTER (WHERE a.is_correct)::int AS correct
     FROM answers a JOIN questions q ON q.id = a.question_id
     WHERE a.user_id = $1
     GROUP BY q.area, q.discipline
     ORDER BY total DESC`,
    [userId]
  );
  return result.rows.map((row) => ({ ...row, percent: percent(row.correct, row.total) }));
}

// Respostas por dia nos últimos 30 dias (no horário de Brasília)
async function getByDay(userId) {
  const result = await pool.query(
    `SELECT to_char(a.answered_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
            count(*)::int AS total,
            count(*) FILTER (WHERE a.is_correct)::int AS correct
     FROM answers a
     WHERE a.user_id = $1 AND a.answered_at > now() - interval '30 days'
     GROUP BY day
     ORDER BY day`,
    [userId]
  );
  return result.rows;
}

// ------------------------------------------------------------
// GET /api/stats: tudo o que o dashboard e a página de desempenho mostram
// ------------------------------------------------------------
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // Histórico: últimas 30 respostas
  const history = await pool.query(
    `SELECT a.id, a.question_id, a.selected_letter, a.is_correct, a.answered_at,
            left(q.statement, 140) AS statement_preview, q.discipline, q.subject
     FROM answers a JOIN questions q ON q.id = a.question_id
     WHERE a.user_id = $1
     ORDER BY a.answered_at DESC
     LIMIT 30`,
    [userId]
  );

  res.json({
    totals: await getTotals(userId),
    by_discipline: await getByDiscipline(userId),
    by_day: await getByDay(userId),
    history: history.rows,
  });
});

// ------------------------------------------------------------
// Análise de desempenho com IA
// ------------------------------------------------------------

// Última análise gerada (para não precisar gerar de novo a cada visita)
router.get('/analysis', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT ai_response, created_at FROM ai_interactions
     WHERE user_id = $1 AND kind = 'analise'
     ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  const row = result.rows[0];
  res.json(row ? { analysis: JSON.parse(row.ai_response), created_at: row.created_at } : { analysis: null });
});

// Gera uma nova análise a partir dos dados REAIS do banco
router.post('/analysis', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const totals = await getTotals(userId);
  if (totals.total < MIN_ANSWERS_FOR_ANALYSIS) {
    return res.status(400).json({
      error: `Responda pelo menos ${MIN_ANSWERS_FOR_ANALYSIS} questões com gabarito para gerar uma análise (você tem ${totals.total}).`,
    });
  }

  await ai.checkDailyLimit(userId, 'analise');

  // Acertos por assunto (mais detalhado que por disciplina)
  const bySubject = await pool.query(
    `SELECT q.discipline, q.subject,
            count(*)::int AS total,
            count(*) FILTER (WHERE a.is_correct)::int AS correct
     FROM answers a JOIN questions q ON q.id = a.question_id
     WHERE a.user_id = $1
     GROUP BY q.discipline, q.subject
     ORDER BY total DESC
     LIMIT 40`,
    [userId]
  );

  // Estes são os ÚNICOS dados que a IA recebe. Os nomes são bem explícitos para a IA não
  // confundir "respostas" (cada tentativa) com "questões diferentes".
  const numbers = (row) => ({
    respostas: row.total,
    acertos: row.correct,
    percentual_acerto: percent(row.correct, row.total),
  });
  const data = {
    geral: {
      respostas: totals.total,
      acertos: totals.correct,
      erros: totals.wrong,
      percentual_acerto: totals.percent,
      questoes_diferentes_resolvidas: totals.questions,
    },
    por_disciplina: (await getByDiscipline(userId)).map((row) => ({ area: row.area, disciplina: row.discipline, ...numbers(row) })),
    por_assunto: bySubject.rows.map((row) => ({ disciplina: row.discipline, assunto: row.subject, ...numbers(row) })),
    respostas_por_dia_ultimos_30_dias: (await getByDay(userId)).map((row) => ({ dia: row.day, respostas: row.total, acertos: row.correct })),
  };

  const analysis = await ai.analyzePerformance(data);
  const createdAt = await ai.saveInteraction(userId, null, 'analise', null, JSON.stringify(analysis));
  res.status(201).json({ analysis, created_at: createdAt });
});

module.exports = router;
