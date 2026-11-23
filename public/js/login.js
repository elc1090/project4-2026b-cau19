// ============================================================
// TELA DE LOGIN
// ============================================================
// O login em si acontece no servidor (auth.js). Esta página só:
//  1. mostra mensagens de erro que o servidor manda pela URL (ex.: /?erro=cancelado)
//  2. leva direto para o Início quem já está logado

const ERROR_MESSAGES = {
  'google-nao-configurado': 'O login com Google ainda não foi configurado no servidor (faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET). Veja o README.',
  cancelado: 'Login cancelado. Tente de novo quando quiser.',
  'estado-invalido': 'Não foi possível confirmar o login (o link expirou). Tente de novo.',
  google: 'O Google não confirmou o login. Tente de novo.',
  sessao: 'Sua sessão terminou. Entre de novo para continuar.',
};

const errorCode = new URLSearchParams(window.location.search).get('erro');
if (errorCode) {
  const message = document.getElementById('login-message');
  message.textContent = ERROR_MESSAGES[errorCode] || 'Não foi possível entrar. Tente de novo.';
  message.hidden = false;
}

// Já está logado? Então não precisa ver esta tela.
fetch('/api/me').then((res) => {
  if (res.ok) window.location.replace('/dashboard.html');
});
