// ============================================================
// AUTENTICAÇÃO: login com Google (OAuth 2.0) + "crachá" JWT num cookie
// ============================================================
// Como funciona o login com Google (3 passos):
//   1. /auth/google: mandamos o navegador para a página de login do Google.
//   2. O usuário escolhe a conta e o Google devolve o navegador para
//      /auth/google/callback?code=XYZ  (o "code" é um vale de uso único).
//   3. O servidor troca esse "code" pelos dados do usuário (nome, e-mail, foto),
//      salva no banco e grava um cookie com o crachá (JWT). Pronto: está logado.
// A senha do usuário nunca passa por aqui: quem confere a senha é o Google.

const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('./database');

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET não definida. Veja o .env.example.');
}

const router = express.Router();

const SESSION_COOKIE = 'sessao';       // cookie com o crachá (JWT)
const STATE_COOKIE = 'oauth_state';    // cookie temporário usado durante o login
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Endereço do site, sem barra no final (no PC: http://localhost:3002; no Render: https://...)
const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3002}`).replace(/\/$/, '');
// Para onde o Google devolve o usuário. Precisa estar cadastrado no Google Cloud Console.
const REDIRECT_URI = `${APP_URL}/auth/google/callback`;

// Opções dos cookies:
//  httpOnly: o JavaScript da página NÃO consegue ler o cookie (um script malicioso não rouba o crachá)
//  sameSite 'lax': o navegador não envia o cookie em pedidos POST vindos de outros sites (protege contra CSRF)
//  secure: em https (Render), o cookie só viaja criptografado
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: APP_URL.startsWith('https'),
};

function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ------------------------------------------------------------
// PASSO 1: manda o navegador para o Google
// ------------------------------------------------------------
router.get('/auth/google', (req, res) => {
  if (!isGoogleConfigured()) {
    return res.redirect('/?erro=google-nao-configurado');
  }

  // "state": um valor aleatório guardado num cookie e enviado ao Google.
  // Na volta conferimos se é o mesmo; isso impede que outro site "injete" um login falso.
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 10 * 60 * 1000 }); // vale 10 minutos

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',   // pedimos só nome, e-mail e foto
    state,
    prompt: 'select_account',        // sempre deixa escolher qual conta usar
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ------------------------------------------------------------
// PASSOS 2 e 3: o Google devolve o usuário para cá
// ------------------------------------------------------------
router.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const savedState = req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, cookieOptions);

  if (error) return res.redirect('/?erro=cancelado'); // o usuário clicou em "Cancelar" no Google
  if (!code || !state || state !== savedState) return res.redirect('/?erro=estado-invalido');

  try {
    // Troca o "code" por um token de acesso. É uma conversa direta servidor -> Google,
    // e é aqui que vai o GOOGLE_CLIENT_SECRET (por isso ele nunca aparece no navegador).
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error('O Google recusou o code:', tokens);
      return res.redirect('/?erro=google');
    }

    // Com o token de acesso, pedimos os dados do perfil
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.sub || !profile.email) {
      console.error('Perfil do Google inválido:', profile);
      return res.redirect('/?erro=google');
    }

    // "Upsert": cria o usuário na 1ª vez; nas próximas, só atualiza nome, e-mail e foto.
    const result = await pool.query(
      `INSERT INTO users (google_id, name, email, picture_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id) DO UPDATE
         SET name = EXCLUDED.name, email = EXCLUDED.email, picture_url = EXCLUDED.picture_url
       RETURNING id`,
      [profile.sub, profile.name || profile.email, profile.email, profile.picture || null]
    );

    // O crachá guarda só o id. O plano NÃO vai no crachá: ele é lido do banco a cada pedido.
    const sessionToken = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.cookie(SESSION_COOKIE, sessionToken, { ...cookieOptions, maxAge: SEVEN_DAYS_MS });
    res.redirect('/dashboard.html');
  } catch (err) {
    console.error('Erro no login com Google:', err);
    res.redirect('/?erro=google');
  }
});

// Sair: basta apagar o cookie do crachá
router.post('/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
  res.status(204).end();
});

// ------------------------------------------------------------
// MIDDLEWARE requireAuth: o "porteiro" das rotas protegidas
// ------------------------------------------------------------
// Roda ANTES da rota. Sem crachá válido, responde 401 e a rota nem executa.
// Com crachá válido, busca o usuário NO BANCO e coloca em req.user.
// Buscar no banco a cada pedido garante que o plano (free/pro) é sempre o atual,
// e que ninguém consegue "se promover" alterando algo no navegador.
async function requireAuth(req, res, next) {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Faça login para acessar' });
  }

  let payload;
  try {
    // verify confere a assinatura e a validade. Se o crachá foi alterado ou expirou, dá erro.
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login de novo' });
  }

  const result = await pool.query(
    'SELECT id, name, email, picture_url, plan, created_at FROM users WHERE id = $1',
    [payload.id]
  );
  if (!result.rows[0]) {
    return res.status(401).json({ error: 'Usuário não encontrado. Faça login de novo' });
  }
  req.user = result.rows[0];
  next();
}

// Dados do usuário logado (o frontend usa para saber quem está logado e qual o plano)
router.get('/api/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// ASSINATURA (DEMONSTRAÇÃO): não existe pagamento de verdade nesta versão.
// O botão "Assinar PRO" do Perfil chama esta rota, que muda o plano do PRÓPRIO usuário
// (o id vem do crachá, nunca do navegador). Numa versão real, quem mudaria o plano seria
// a confirmação de pagamento enviada pela empresa de pagamentos, e não um botão.
router.put('/api/me/plan', requireAuth, async (req, res) => {
  const { plan } = req.body;
  if (!['free', 'pro'].includes(plan)) {
    return res.status(400).json({ error: 'Plano inválido' });
  }
  const result = await pool.query(
    `UPDATE users SET plan = $1 WHERE id = $2
     RETURNING id, name, email, picture_url, plan, created_at`,
    [plan, req.user.id]
  );
  res.json(result.rows[0]);
});

module.exports = { router, requireAuth };
