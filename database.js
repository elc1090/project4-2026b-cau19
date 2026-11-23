const { Pool, types } = require('pg');

// Os ids são "bigint" no banco, e o pg devolve bigint como TEXTO ('12') por segurança
// (números gigantes não cabem no JavaScript). Nossos ids nunca chegam perto desse limite,
// então pedimos ao pg para converter para número (12). 20 = código do tipo bigint no Postgres.
types.setTypeParser(20, Number);

// Quem usa este arquivo precisa ter carregado o .env antes (o server.js faz isso na 1ª linha).
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não definida. Copie .env.example para .env e preencha.');
}

// Pool = conjunto de conexões com o banco, reaproveitadas pelo servidor.
// O banco local (Docker) não usa SSL; o banco do Render exige conexão criptografada.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

module.exports = pool;
