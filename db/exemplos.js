// Coloca 20 questões de exemplo no banco (para demonstrar e testar o app).
// Uso:  npm run db:exemplos -- seu@email.com
//   - 12 questões ficam como SUAS (particulares): você vê e resolve mesmo no plano gratuito.
//   - 8 questões são de um autor de exemplo ("Gabarito Exemplos") e ficam COMPARTILHADAS:
//     só aparecem para quem é PRO (é assim que dá para demonstrar o plano PRO).
// O usuário precisa ter entrado no site com o Google pelo menos uma vez.
// Pode rodar mais de uma vez: questões que já existem (mesmo enunciado e autor) são puladas.
// As questões ficam em db/exemplos.json (inéditas, elaboradas para o projeto).
require('dotenv').config();
const pool = require('../database');
const questions = require('./exemplos.json');

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.log('Uso: npm run db:exemplos -- seu@email.com');
    process.exit(1);
  }

  const me = await pool.query('SELECT id, name FROM users WHERE email = $1', [email]);
  if (!me.rows[0]) {
    console.log(`Nenhum usuário com o e-mail ${email}. Entre no site com o Google pelo menos uma vez.`);
    process.exit(1);
  }

  // Autor das questões compartilhadas. Não é uma conta de verdade: não tem como fazer login.
  const sample = await pool.query(
    `INSERT INTO users (google_id, name, email) VALUES ('exemplos-gabarito', 'Gabarito Exemplos', 'exemplos@gabarito.local')
     ON CONFLICT (google_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );

  let created = 0;
  for (const q of questions) {
    const authorId = q.is_shared ? sample.rows[0].id : me.rows[0].id;
    const exists = await pool.query(
      'SELECT 1 FROM questions WHERE author_id = $1 AND statement = $2',
      [authorId, q.statement]
    );
    if (exists.rowCount > 0) continue;

    // Mesma ideia da rota POST /api/questions: questão + alternativas numa transação
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO questions (author_id, statement, area, discipline, subject, subsubject,
                                correct_letter, explanation, source, is_shared)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [authorId, q.statement, q.area, q.discipline, q.subject, q.subsubject || null,
          q.correct_letter, q.explanation, 'Questão de exemplo (inédita)', q.is_shared]
      );
      for (let i = 0; i < q.alternatives.length; i++) {
        await client.query(
          'INSERT INTO alternatives (question_id, letter, text) VALUES ($1, $2, $3)',
          [inserted.rows[0].id, LETTERS[i], q.alternatives[i]]
        );
      }
      await client.query('COMMIT');
      created++;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const mine = questions.filter((q) => !q.is_shared).length;
  console.log(`OK: ${created} questões criadas (${questions.length - created} já existiam).`);
  console.log(`${mine} são de ${me.rows[0].name}; ${questions.length - mine} são compartilhadas por "Gabarito Exemplos" (aparecem para quem é PRO).`);
  await pool.end();
}

main().catch((error) => {
  console.error('Erro:', error.message);
  process.exit(1);
});
