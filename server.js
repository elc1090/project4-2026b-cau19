// ============================================================
// SERVIDOR: liga o Express, entrega o frontend e responde a API
// ============================================================

// Lê o arquivo .env e coloca cada linha em process.env (ex.: process.env.PORT).
// No Render não existe .env: as variáveis vêm do painel, e esta linha simplesmente não faz nada.
// Precisa ser a PRIMEIRA linha: os outros arquivos já usam process.env quando são carregados.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const pool = require('./database');
const auth = require('./auth');
const questionRoutes = require('./routes/questions');
const statsRoutes = require('./routes/stats');

const app = express();
// O Render escolhe a porta e avisa pela variável PORT. No seu PC, usamos a do .env (ou 3002).
const PORT = process.env.PORT || 3002;

// Transforma o corpo dos pedidos em JSON (req.body). O limite é maior que o padrão (100 KB)
// porque a imagem da questão chega dentro do JSON (já reduzida pelo navegador).
app.use(express.json({ limit: '8mb' }));
// Lê os cookies do pedido e coloca em req.cookies (é onde fica o crachá de login)
app.use(cookieParser());

// Entrega os arquivos do frontend (HTML, CSS, JS, imagens) da pasta public.
// __dirname = pasta onde este arquivo está, assim o caminho funciona de qualquer lugar.
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ROTAS
// ============================================================

// Rota de teste: confirma que o servidor está no ar.
// Também serve como "health check" no Render (ele consulta essa URL para saber se o app está vivo).
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use(auth.router);                 // /auth/google, /auth/google/callback, /auth/logout, /api/me
app.use('/api', questionRoutes);      // /api/questions/..., /api/me/questions/...
app.use('/api/stats', statsRoutes);   // /api/stats

// Qualquer /api/... que não existe responde 404 em JSON, e não com uma página HTML de erro.
// Fica DEPOIS de todas as rotas da API: o Express testa as rotas na ordem em que foram escritas.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Tratador de erros (tem 4 parâmetros: é assim que o Express sabe que ele trata erros).
// No Express 5, erros de rotas "async" também chegam aqui automaticamente.
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Arquivo grande demais' });
  }
  // Erros "previstos" (ex.: limite diário da IA) já trazem status e mensagem para o usuário
  if (error.expose && error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  res.status(500).json({ error: 'Erro interno no servidor' });
});

// ============================================================
// LIGAR: primeiro confere as tabelas do banco, depois abre a porta
// ============================================================
async function start() {
  // Roda o db/schema.sql. Como ele usa "if not exists", só cria o que ainda não existe.
  // Assim, no Render, as tabelas são criadas sozinhas no primeiro deploy.
  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('Banco de dados conectado e tabelas conferidas.');

  app.listen(PORT, (error) => {
    if (error) throw error; // ex.: porta ocupada (EADDRINUSE): outro servidor já está usando a porta
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    if (!process.env.GOOGLE_CLIENT_ID) console.log('Aviso: login Google ainda não configurado (veja o README).');
    const aiKeys = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY'].filter((name) => process.env[name]);
    console.log(aiKeys.length ? `IAs configuradas: ${aiKeys.join(', ')}` : 'Aviso: IA ainda não configurada (veja o README).');
  });
}

start().catch((error) => {
  console.error('Não foi possível ligar o servidor:', error.message);
  console.error('O banco está ligado? Localmente: docker compose up -d');
  process.exit(1);
});
