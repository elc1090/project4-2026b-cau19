// Roda um arquivo .sql no banco indicado pelo DATABASE_URL.
// Uso:  node db/run-sql.js db/reset.sql      (ou:  npm run db:reset)
// Vantagem sobre o psql: funciona igual no Windows, sem instalar nada e sem perder acentos.
require('dotenv').config();
const fs = require('fs');
const pool = require('../database');

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('Uso: node db/run-sql.js caminho/do/arquivo.sql');
    process.exit(1);
  }
  const sql = fs.readFileSync(file, 'utf8');
  await pool.query(sql);
  console.log(`OK: ${file} executado.`);
  await pool.end();
}

main().catch((error) => {
  console.error('Erro:', error.message);
  process.exit(1);
});
