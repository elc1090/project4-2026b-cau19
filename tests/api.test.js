// Testes da API: acessos PERMITIDOS e NÃO PERMITIDOS (principalmente a regra do plano PRO).
// Usa só o que já vem no Node (node:test, assert e fetch).
//
// Como rodar: deixe o servidor ligado (npm start) num terminal e, em outro:  npm test
//
// O login de verdade é pelo Google, que não dá para automatizar. Por isso os testes criam
// usuários direto no banco e geram o crachá (JWT) com o mesmo JWT_SECRET do servidor.
// No final, os usuários de teste são apagados (e as questões deles somem junto).
require('dotenv').config();
const { test, after } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const pool = require('../database');

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3002}`;
const suffix = Date.now().toString();
const users = {}; // alice (free), bob (free), carol (pro)

// Faz um pedido à API como um usuário (ou sem login, se user for null)
async function api(path, { method = 'GET', body, user } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (user) headers.Cookie = `sessao=${user.token}`;
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function createUser(name, plan) {
  const result = await pool.query(
    `INSERT INTO users (google_id, name, email, plan) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`teste-${name}-${suffix}`, `${name} Teste`, `${name}.${suffix}@teste.local`, plan]
  );
  const id = result.rows[0].id;
  return { id, token: jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' }) };
}

function sampleQuestion(overrides = {}) {
  return {
    statement: 'Segundo a Constituição Federal, todos são iguais perante a lei?',
    alternatives: ['Certo', 'Errado'],
    correct_letter: 'A',
    area: 'Direito',
    discipline: 'Direito Constitucional',
    subject: 'Direitos Fundamentais',
    source: 'Teste automático',
    is_shared: false,
    ...overrides,
  };
}

const ids = {}; // ids das questões criadas nos testes

after(async () => {
  await pool.query('DELETE FROM users WHERE google_id LIKE $1', [`teste-%-${suffix}`]);
  await pool.end();
});

test('preparação: cria usuários de teste (2 free e 1 pro)', async () => {
  users.alice = await createUser('alice', 'free');
  users.bob = await createUser('bob', 'free');
  users.carol = await createUser('carol', 'pro');
});

test('servidor no ar: GET /api/health responde 200', async () => {
  const res = await api('/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});

test('sem login: /api/me e /api/questions respondem 401', async () => {
  assert.strictEqual((await api('/api/me')).status, 401);
  assert.strictEqual((await api('/api/questions')).status, 401);
});

test('crachá falsificado: responde 401', async () => {
  const fake = { token: jwt.sign({ id: users.alice.id }, 'chave-errada') };
  assert.strictEqual((await api('/api/me', { user: fake })).status, 401);
});

test('com login: /api/me devolve o usuário e o plano', async () => {
  const res = await api('/api/me', { user: users.carol });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.plan, 'pro');
});

test('cadastro: dados inválidos são recusados (400)', async () => {
  const semAlternativas = await api('/api/questions', { method: 'POST', user: users.alice, body: sampleQuestion({ alternatives: ['só uma'] }) });
  assert.strictEqual(semAlternativas.status, 400);
  const gabaritoInvalido = await api('/api/questions', { method: 'POST', user: users.alice, body: sampleQuestion({ correct_letter: 'E' }) });
  assert.strictEqual(gabaritoInvalido.status, 400);
});

test('cadastro: Alice cria uma questão particular, uma compartilhada e uma sem gabarito', async () => {
  const particular = await api('/api/questions', { method: 'POST', user: users.alice, body: sampleQuestion() });
  assert.strictEqual(particular.status, 201);
  ids.private = particular.body.id;

  const compartilhada = await api('/api/questions', {
    method: 'POST', user: users.alice,
    body: sampleQuestion({ statement: 'Questão compartilhada de teste: quanto é 2 + 2?', alternatives: ['3', '4', '5'], correct_letter: 'B', is_shared: true, area: 'Matemática', discipline: 'Matemática Básica', subject: 'Adição' }),
  });
  assert.strictEqual(compartilhada.status, 201);
  ids.shared = compartilhada.body.id;

  const semGabarito = await api('/api/questions', { method: 'POST', user: users.alice, body: sampleQuestion({ correct_letter: null }) });
  assert.strictEqual(semGabarito.status, 201);
  ids.noKey = semGabarito.body.id;
});

test('resolver: a questão vem SEM gabarito e SEM explicação', async () => {
  const res = await api(`/api/questions/${ids.private}`, { user: users.alice });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.correct_letter, undefined);
  assert.strictEqual(res.body.explanation, undefined);
  assert.strictEqual(res.body.alternatives.length, 2);
});

test('PRO: Bob (free) NÃO vê as questões da Alice, nem as compartilhadas', async () => {
  assert.strictEqual((await api(`/api/questions/${ids.private}`, { user: users.bob })).status, 404);
  assert.strictEqual((await api(`/api/questions/${ids.shared}`, { user: users.bob })).status, 404);
  assert.strictEqual((await api('/api/questions?scope=shared', { user: users.bob })).status, 403);

  const lista = await api('/api/questions', { user: users.bob });
  assert.strictEqual(lista.status, 200);
  assert.ok(!lista.body.some((q) => q.id === ids.shared || q.id === ids.private));
});

test('PRO: Bob (free) não consegue responder a compartilhada', async () => {
  assert.strictEqual((await api(`/api/questions/${ids.shared}/answer`, { method: 'POST', user: users.bob, body: { letter: 'B' } })).status, 404);
});

test('PRO: Carol (pro) vê a compartilhada, mas NÃO a particular', async () => {
  assert.strictEqual((await api(`/api/questions/${ids.shared}`, { user: users.carol })).status, 200);
  assert.strictEqual((await api(`/api/questions/${ids.private}`, { user: users.carol })).status, 404);

  const lista = await api('/api/questions?scope=shared', { user: users.carol });
  assert.strictEqual(lista.status, 200);
  assert.ok(lista.body.some((q) => q.id === ids.shared));
  assert.ok(!lista.body.some((q) => q.id === ids.private));
});

test('autoria: só a autora edita, vê o gabarito para edição e apaga', async () => {
  const edicao = sampleQuestion({ statement: 'Enunciado editado pela autora' });
  assert.strictEqual((await api(`/api/questions/${ids.private}`, { method: 'PUT', user: users.bob, body: edicao })).status, 404);
  assert.strictEqual((await api(`/api/questions/${ids.shared}`, { method: 'PUT', user: users.carol, body: edicao })).status, 404);
  assert.strictEqual((await api(`/api/questions/${ids.shared}`, { method: 'DELETE', user: users.carol })).status, 404);
  assert.strictEqual((await api(`/api/me/questions/${ids.private}`, { user: users.bob })).status, 404);

  assert.strictEqual((await api(`/api/questions/${ids.private}`, { method: 'PUT', user: users.alice, body: edicao })).status, 200);
  const paraEditar = await api(`/api/me/questions/${ids.private}`, { user: users.alice });
  assert.strictEqual(paraEditar.body.statement, 'Enunciado editado pela autora');
  assert.strictEqual(paraEditar.body.correct_letter, 'A');
});

test('responder: o servidor corrige e grava no histórico', async () => {
  const errada = await api(`/api/questions/${ids.shared}/answer`, { method: 'POST', user: users.carol, body: { letter: 'A' } });
  assert.strictEqual(errada.status, 200);
  assert.strictEqual(errada.body.is_correct, false);
  assert.strictEqual(errada.body.correct_letter, 'B');

  const certa = await api(`/api/questions/${ids.shared}/answer`, { method: 'POST', user: users.carol, body: { letter: 'B' } });
  assert.strictEqual(certa.body.is_correct, true);

  const inexistente = await api(`/api/questions/${ids.shared}/answer`, { method: 'POST', user: users.carol, body: { letter: 'E' } });
  assert.strictEqual(inexistente.status, 400);
});

test('responder: questão sem gabarito não entra nas estatísticas', async () => {
  const res = await api(`/api/questions/${ids.noKey}/answer`, { method: 'POST', user: users.alice, body: { letter: 'A' } });
  assert.strictEqual(res.body.has_answer_key, false);
  assert.strictEqual(res.body.recorded, false);
});

test('desempenho: estatísticas da Carol refletem as respostas reais', async () => {
  const res = await api('/api/stats', { user: users.carol });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.totals.total, 2);
  assert.strictEqual(res.body.totals.correct, 1);
  assert.strictEqual(res.body.totals.wrong, 1);
  assert.strictEqual(res.body.totals.percent, 50);
  assert.strictEqual(res.body.by_discipline[0].discipline, 'Matemática Básica');
});

test('IA: imagem inválida é recusada antes de chamar a IA (400)', async () => {
  const res = await api('/api/questions/extract', { method: 'POST', user: users.alice, body: { image: 'isto não é uma imagem' } });
  assert.strictEqual(res.status, 400);
});

test('filtros e pesquisa funcionam', async () => {
  const porArea = await api('/api/questions?area=Matem%C3%A1tica', { user: users.alice });
  assert.ok(porArea.body.every((q) => q.area === 'Matemática'));
  const busca = await api('/api/questions?search=editado', { user: users.alice });
  assert.ok(busca.body.some((q) => q.id === ids.private));
});

test('plano: a assinatura demonstrativa vale na hora e só aceita valores válidos', async () => {
  assert.strictEqual((await api('/api/me/plan', { method: 'PUT', body: { plan: 'pro' } })).status, 401); // sem login
  assert.strictEqual((await api('/api/me/plan', { method: 'PUT', user: users.bob, body: { plan: 'premium' } })).status, 400);

  // Bob vira PRO: passa a ver a compartilhada, mas a particular da Alice continua bloqueada
  const upgrade = await api('/api/me/plan', { method: 'PUT', user: users.bob, body: { plan: 'pro' } });
  assert.strictEqual(upgrade.status, 200);
  assert.strictEqual(upgrade.body.plan, 'pro');
  assert.strictEqual((await api(`/api/questions/${ids.shared}`, { user: users.bob })).status, 200);
  assert.strictEqual((await api(`/api/questions/${ids.private}`, { user: users.bob })).status, 404);

  // Volta para o gratuito: perde o acesso na hora (o plano é lido do banco a cada pedido)
  await api('/api/me/plan', { method: 'PUT', user: users.bob, body: { plan: 'free' } });
  assert.strictEqual((await api(`/api/questions/${ids.shared}`, { user: users.bob })).status, 404);
});

test('apagar: a autora apaga e a questão deixa de existir', async () => {
  assert.strictEqual((await api(`/api/questions/${ids.private}`, { method: 'DELETE', user: users.alice })).status, 204);
  assert.strictEqual((await api(`/api/questions/${ids.private}`, { user: users.alice })).status, 404);
});
