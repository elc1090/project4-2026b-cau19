// ============================================================
// ROTAS DE DESEMPENHO: estatísticas (calculadas direto do banco, sem IA)
// ============================================================
// Tudo aqui usa só as respostas do PRÓPRIO usuário (WHERE user_id = req.user.id).

const express = require('express');
const pool = require('../database');
const { requireAuth } = require('../auth');

const router = express.Router();

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

module.exports = router;
