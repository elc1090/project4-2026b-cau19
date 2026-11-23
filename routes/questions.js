// ============================================================
// ROTAS DAS QUESTÕES: cadastrar, listar, filtrar, editar, apagar, responder e tirar dúvidas
// ============================================================
// Todas as rotas usam requireAuth (só para quem está logado).
// O id e o plano do usuário vêm SEMPRE de req.user (lido do banco), nunca do navegador.
// Observação: no Express 5, se uma rota "async" der erro, ele vai sozinho para o
// tratador de erros do server.js (que responde 500). Por isso não há try/catch em toda rota.

const express = require('express');
const pool = require('../database');
const { requireAuth } = require('../auth');
const ai = require('../ai');

const router = express.Router();
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// ------------------------------------------------------------
// REGRA DE ACESSO (a mais importante do sistema)
// ------------------------------------------------------------
// O usuário pode ver uma questão se for o AUTOR dela,
// ou se ela for COMPARTILHADA e ele for PRO.
// Este trecho entra no WHERE de TODA consulta que lê questões.
// Convenção: $1 = id do usuário e $2 = plano do usuário (os dois vêm de req.user).
const CAN_SEE = `(q.author_id = $1 OR (q.is_shared AND $2 = 'pro'))`;

// Converte o :id da URL em número. Devolve null se não for um número inteiro positivo.
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Confere os dados de uma questão vindos do navegador.
// Devolve { error: 'mensagem' } ou { question: dados limpos }.
function validateQuestion(body) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');

  const question = {
    statement: text(body.statement),
    area: text(body.area),
    discipline: text(body.discipline),
    subject: text(body.subject),
    subsubject: text(body.subsubject) || null,
    explanation: text(body.explanation) || null,
    source: text(body.source) || null,
    correct_letter: body.correct_letter || null,
    is_shared: body.is_shared === true,
    // As alternativas chegam como lista de textos, na ordem: a 1ª é A, a 2ª é B...
    alternatives: Array.isArray(body.alternatives) ? body.alternatives.map(text) : [],
  };

  if (question.statement.length < 5 || question.statement.length > 10000) {
    return { error: 'O enunciado deve ter entre 5 e 10.000 caracteres' };
  }
  if (!question.area || !question.discipline || !question.subject) {
    return { error: 'Informe a área, a disciplina e o assunto' };
  }
  const names = [question.area, question.discipline, question.subject, question.subsubject || ''];
  if (names.some((name) => name.length > 100)) {
    return { error: 'Área, disciplina, assunto e subassunto podem ter até 100 caracteres' };
  }
  if ((question.source || '').length > 300) {
    return { error: 'A origem pode ter até 300 caracteres' };
  }
  if ((question.explanation || '').length > 10000) {
    return { error: 'A explicação pode ter até 10.000 caracteres' };
  }
  if (question.alternatives.length < 2 || question.alternatives.length > 5) {
    return { error: 'A questão precisa ter de 2 a 5 alternativas' };
  }
  if (question.alternatives.some((alt) => alt.length === 0 || alt.length > 3000)) {
    return { error: 'Nenhuma alternativa pode ficar vazia (máximo de 3.000 caracteres cada)' };
  }
  // O gabarito, se informado, tem que ser a letra de uma alternativa que existe
  const validLetters = LETTERS.slice(0, question.alternatives.length);
  if (question.correct_letter !== null && !validLetters.includes(question.correct_letter)) {
    return { error: 'O gabarito precisa ser uma das alternativas' };
  }
  return { question };
}

// Grava as alternativas de uma questão (dentro de uma transação já aberta)
async function insertAlternatives(client, questionId, alternatives) {
  for (let i = 0; i < alternatives.length; i++) {
    await client.query(
      'INSERT INTO alternatives (question_id, letter, text) VALUES ($1, $2, $3)',
      [questionId, LETTERS[i], alternatives[i]]
    );
  }
}

// ============================================================
// CADASTRO POR IMAGEM: a IA lê o print e devolve uma PRÉVIA (nada é salvo ainda)
// ============================================================
router.post('/questions/extract', requireAuth, async (req, res) => {
  const { image } = req.body;

  // A imagem chega como "data URL": data:image/jpeg;base64,AAAA...
  const match = typeof image === 'string'
    && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!match) {
    return res.status(400).json({ error: 'Envie uma imagem JPG, PNG ou WEBP' });
  }
  const mimeType = match[1];
  const imageBase64 = match[2];
  if (imageBase64.length > 7000000) { // ~5 MB de imagem
    return res.status(413).json({ error: 'Imagem grande demais (máximo de 5 MB)' });
  }

  await ai.checkDailyLimit(req.user.id, 'extracao');

  // Nomes de classificação que o usuário já enxerga, para a IA reaproveitar
  const namesResult = await pool.query(
    `SELECT DISTINCT q.area, q.discipline, q.subject FROM questions q WHERE ${CAN_SEE} LIMIT 300`,
    [req.user.id, req.user.plan]
  );
  const unique = (field) => [...new Set(namesResult.rows.map((row) => row[field]))];
  const existingNames = {
    areas: unique('area'),
    disciplines: unique('discipline'),
    subjects: unique('subject'),
  };

  const extracted = await ai.extractQuestion(imageBase64, mimeType, existingNames);
  await ai.saveInteraction(req.user.id, null, 'extracao', null, JSON.stringify(extracted));
  res.json(extracted);
});

// ============================================================
// SALVAR uma questão (depois que o usuário revisou a prévia)
// ============================================================
router.post('/questions', requireAuth, async (req, res) => {
  const { error, question } = validateQuestion(req.body);
  if (error) return res.status(400).json({ error });

  // TRANSAÇÃO: a questão e as alternativas são salvas juntas. Se algo falhar no meio,
  // o ROLLBACK desfaz tudo (não fica questão sem alternativas).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO questions (author_id, statement, area, discipline, subject, subsubject,
                              correct_letter, explanation, source, is_shared)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [req.user.id, question.statement, question.area, question.discipline, question.subject,
        question.subsubject, question.correct_letter, question.explanation, question.source,
        question.is_shared]
    );
    const questionId = inserted.rows[0].id;
    await insertAlternatives(client, questionId, question.alternatives);
    await client.query('COMMIT');
    res.status(201).json({ id: questionId });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // vai para o tratador de erros (500)
  } finally {
    client.release(); // devolve a conexão para o pool
  }
});

// ============================================================
// LISTAR questões (banco de questões), com filtros e pesquisa
// ============================================================
// Parâmetros (todos opcionais): area, discipline, subject, search, scope
// scope: 'all' (padrão) | 'mine' (só minhas) | 'shared' (compartilhadas por outros, só PRO)
router.get('/questions', requireAuth, async (req, res) => {
  const { area, discipline, subject, search, scope = 'all' } = req.query;

  if (!['all', 'mine', 'shared'].includes(scope)) {
    return res.status(400).json({ error: 'Filtro de escopo inválido' });
  }
  if (scope === 'shared' && req.user.plan !== 'pro') {
    return res.status(403).json({ error: 'O banco compartilhado é exclusivo do plano PRO', pro_required: true });
  }

  // Monta o WHERE aos poucos. Cada valor vai em "params" e entra no SQL como $3, $4...
  // (nunca colamos o texto do usuário direto no SQL: isso evita SQL injection)
  const params = [req.user.id, req.user.plan];
  const conditions = [CAN_SEE];

  if (typeof area === 'string' && area) {
    params.push(area);
    conditions.push(`q.area = $${params.length}`);
  }
  if (typeof discipline === 'string' && discipline) {
    params.push(discipline);
    conditions.push(`q.discipline = $${params.length}`);
  }
  if (typeof subject === 'string' && subject) {
    params.push(subject);
    conditions.push(`q.subject = $${params.length}`);
  }
  if (typeof search === 'string' && search.trim()) {
    params.push(`%${search.trim()}%`); // ILIKE '%palavra%' = "contém", sem diferenciar maiúsculas
    const n = params.length;
    conditions.push(`(q.statement ILIKE $${n} OR q.subject ILIKE $${n} OR q.subsubject ILIKE $${n} OR q.source ILIKE $${n})`);
  }
  if (scope === 'mine') conditions.push('q.author_id = $1');
  if (scope === 'shared') conditions.push('q.author_id <> $1');

  const result = await pool.query(
    `SELECT q.id, left(q.statement, 300) AS statement_preview, q.area, q.discipline, q.subject,
            q.subsubject, q.source, q.is_shared, q.created_at,
            (q.author_id = $1) AS is_mine,
            split_part(u.name, ' ', 1) AS author_name,
            (q.correct_letter IS NOT NULL) AS has_answer_key,
            (SELECT a.is_correct FROM answers a
              WHERE a.question_id = q.id AND a.user_id = $1
              ORDER BY a.answered_at DESC LIMIT 1) AS last_result
     FROM questions q
     JOIN users u ON u.id = q.author_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY q.created_at DESC
     LIMIT 100`,
    params
  );
  res.json(result.rows);
});

// Opções dos filtros: combinações de área/disciplina/assunto que o usuário pode ver
router.get('/questions/filters', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT q.area, q.discipline, q.subject FROM questions q
     WHERE ${CAN_SEE} ORDER BY q.area, q.discipline, q.subject`,
    [req.user.id, req.user.plan]
  );
  res.json(result.rows);
});

// ============================================================
// UMA questão, para resolver. O GABARITO e a EXPLICAÇÃO NÃO vão aqui:
// eles só são enviados depois que o usuário responde (POST /answer).
// ============================================================
router.get('/questions/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id inválido' });

  const result = await pool.query(
    `SELECT q.id, q.statement, q.area, q.discipline, q.subject, q.subsubject, q.source,
            q.is_shared, q.created_at, (q.author_id = $1) AS is_mine,
            split_part(u.name, ' ', 1) AS author_name,
            (q.correct_letter IS NOT NULL) AS has_answer_key
     FROM questions q JOIN users u ON u.id = q.author_id
     WHERE q.id = $3 AND ${CAN_SEE}`,
    [req.user.id, req.user.plan, id]
  );
  const question = result.rows[0];
  // Mesma resposta para "não existe" e "não tem permissão": assim ninguém descobre
  // quais questões existem tentando números.
  if (!question) return res.status(404).json({ error: 'Questão não encontrada' });

  const alternatives = await pool.query(
    'SELECT letter, text FROM alternatives WHERE question_id = $1 ORDER BY letter',
    [id]
  );
  question.alternatives = alternatives.rows;
  res.json(question);
});

// ============================================================
// RESPONDER: o servidor confere a resposta e grava no histórico
// ============================================================
router.post('/questions/:id/answer', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id inválido' });
  const { letter } = req.body;
  if (!LETTERS.includes(letter)) return res.status(400).json({ error: 'Escolha uma alternativa' });

  const result = await pool.query(
    `SELECT q.correct_letter, q.explanation,
            EXISTS (SELECT 1 FROM alternatives al WHERE al.question_id = q.id AND al.letter = $4) AS letter_exists
     FROM questions q
     WHERE q.id = $3 AND ${CAN_SEE}`,
    [req.user.id, req.user.plan, id, letter]
  );
  const question = result.rows[0];
  if (!question) return res.status(404).json({ error: 'Questão não encontrada' });
  if (!question.letter_exists) return res.status(400).json({ error: 'Essa alternativa não existe' });

  // Sem gabarito não dá para corrigir: não entra nas estatísticas
  if (question.correct_letter === null) {
    return res.json({
      has_answer_key: false,
      is_correct: null,
      correct_letter: null,
      explanation: question.explanation,
      recorded: false,
    });
  }

  const isCorrect = letter === question.correct_letter;
  await pool.query(
    'INSERT INTO answers (user_id, question_id, selected_letter, is_correct) VALUES ($1, $2, $3, $4)',
    [req.user.id, id, letter, isCorrect]
  );
  res.json({
    has_answer_key: true,
    is_correct: isCorrect,
    correct_letter: question.correct_letter,
    explanation: question.explanation,
    recorded: true,
  });
});

// ============================================================
// DÚVIDAS COM IA sobre uma questão
// ============================================================

// Dúvidas anteriores do próprio usuário sobre esta questão
router.get('/questions/:id/doubts', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id inválido' });

  const visible = await pool.query(
    `SELECT 1 FROM questions q WHERE q.id = $3 AND ${CAN_SEE}`,
    [req.user.id, req.user.plan, id]
  );
  if (visible.rowCount === 0) return res.status(404).json({ error: 'Questão não encontrada' });

  const result = await pool.query(
    `SELECT user_message, ai_response, created_at FROM ai_interactions
     WHERE user_id = $1 AND question_id = $2 AND kind = 'duvida'
     ORDER BY created_at`,
    [req.user.id, id]
  );
  res.json(result.rows);
});

// Envia uma nova dúvida para a IA
router.post('/questions/:id/doubts', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id inválido' });
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (message.length < 3 || message.length > 1000) {
    return res.status(400).json({ error: 'Escreva sua dúvida (de 3 a 1.000 caracteres)' });
  }

  const result = await pool.query(
    `SELECT q.id, q.statement, q.area, q.discipline, q.subject, q.correct_letter
     FROM questions q WHERE q.id = $3 AND ${CAN_SEE}`,
    [req.user.id, req.user.plan, id]
  );
  const question = result.rows[0];
  if (!question) return res.status(404).json({ error: 'Questão não encontrada' });

  await ai.checkDailyLimit(req.user.id, 'duvida');

  const alternatives = await pool.query(
    'SELECT letter, text FROM alternatives WHERE question_id = $1 ORDER BY letter',
    [id]
  );
  question.alternatives = alternatives.rows;

  // Última resposta do usuário. O gabarito só vai para a IA se ele já respondeu,
  // para a IA não "entregar" a resposta antes da hora.
  const lastAnswer = await pool.query(
    `SELECT selected_letter FROM answers WHERE user_id = $1 AND question_id = $2
     ORDER BY answered_at DESC LIMIT 1`,
    [req.user.id, id]
  );
  const selectedLetter = lastAnswer.rows[0]?.selected_letter || null;

  // As 3 últimas dúvidas sobre esta questão, para a IA entender perguntas de continuação
  const history = await pool.query(
    `SELECT user_message, ai_response FROM ai_interactions
     WHERE user_id = $1 AND question_id = $2 AND kind = 'duvida'
     ORDER BY created_at DESC LIMIT 3`,
    [req.user.id, id]
  );

  const answer = await ai.answerDoubt({
    question,
    correctLetter: selectedLetter ? question.correct_letter : null,
    selectedLetter,
    history: history.rows.reverse(), // da mais antiga para a mais nova
    message,
  });

  const createdAt = await ai.saveInteraction(req.user.id, id, 'duvida', message, answer);
  res.status(201).json({ user_message: message, ai_response: answer, created_at: createdAt });
});

// ============================================================
// MINHAS QUESTÕES: gerenciar (ver, editar, apagar) as questões que EU cadastrei
// ============================================================
router.get('/me/questions', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT q.id, left(q.statement, 300) AS statement_preview, q.area, q.discipline, q.subject,
            q.subsubject, q.source, q.is_shared, q.created_at,
            (q.correct_letter IS NOT NULL) AS has_answer_key,
            (SELECT count(*)::int FROM answers a WHERE a.question_id = q.id) AS answer_count
     FROM questions q
     WHERE q.author_id = $1
     ORDER BY q.created_at DESC`,
    [req.user.id]
  );
  res.json(result.rows);
});

// Questão completa (com gabarito), para o AUTOR editar
router.get('/me/questions/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id inválido' });

  const result = await pool.query(
    `SELECT id, statement, area, discipline, subject, subsubject, correct_letter, explanation,
            source, is_shared, created_at
     FROM questions WHERE id = $1 AND author_id = $2`,
    [id, req.user.id]
  );
  const question = result.rows[0];
  if (!question) return res.status(404).json({ error: 'Questão não encontrada entre as suas' });

  const alternatives = await pool.query(
    'SELECT letter, text FROM alternatives WHERE question_id = $1 ORDER BY letter',
    [id]
  );
  question.alternatives = alternatives.rows.map((alt) => alt.text);
  res.json(question);
});

// Editar. AUTORIZAÇÃO: o "AND author_id = ..." garante que só o autor consegue editar.
router.put('/questions/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id inválido' });
  const { error, question } = validateQuestion(req.body);
  if (error) return res.status(400).json({ error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE questions
       SET statement = $1, area = $2, discipline = $3, subject = $4, subsubject = $5,
           correct_letter = $6, explanation = $7, source = $8, is_shared = $9
       WHERE id = $10 AND author_id = $11`,
      [question.statement, question.area, question.discipline, question.subject,
        question.subsubject, question.correct_letter, question.explanation, question.source,
        question.is_shared, id, req.user.id]
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Questão não encontrada entre as suas' });
    }
    // Jeito simples de atualizar as alternativas: apaga as antigas e grava as novas
    await client.query('DELETE FROM alternatives WHERE question_id = $1', [id]);
    await insertAlternatives(client, id, question.alternatives);
    await client.query('COMMIT');
    res.json({ id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Apagar. Mesma ideia: só o autor. As alternativas e respostas somem junto (on delete cascade).
router.delete('/questions/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Id inválido' });

  const result = await pool.query(
    'DELETE FROM questions WHERE id = $1 AND author_id = $2',
    [id, req.user.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Questão não encontrada entre as suas' });
  }
  res.status(204).end(); // 204 = deu certo, sem conteúdo para devolver
});

module.exports = router;
