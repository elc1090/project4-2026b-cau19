// ============================================================
// IA: todas as conversas com o Gemini (Google) ficam neste arquivo
// ============================================================
// Usamos a "Interactions API" do Gemini com fetch puro (sem biblioteca).
// A chave GEMINI_API_KEY fica só aqui no servidor: o navegador nunca a vê.
// Plano gratuito: tem limite de pedidos por dia, e o Google pode usar o conteúdo
// enviado para melhorar os produtos dele (não envie dados pessoais para a IA).

const pool = require('./database');

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
// Modelos do Gemini, na ordem em que são tentados (todos têm plano gratuito em nov/2026).
// No plano gratuito o Google atende por último: em horário de pico um modelo pode recusar
// ("sobrecarregado") ou demorar quase 1 minuto. Por isso o app tenta vários, um depois do outro.
// A variável GEMINI_MODEL (opcional) coloca outro modelo em 1º lugar.
const MODELS = [
  'gemini-3.8-flash',      // o melhor, mas o mais disputado
  'gemini-3.5-flash-lite', // o que mais respondeu nos testes (e o mais barato se houver faturamento)
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
];
const ATTEMPT_TIMEOUT_MS = 60000; // cada modelo tem até 60 s para responder
const TOTAL_TIME_MS = 120000;     // depois de 2 minutos tentando, desiste

// Limite de usos por usuário a cada 24 horas. A cota gratuita do Gemini é do PROJETO
// inteiro (compartilhada por todos os usuários), então ninguém pode gastá-la sozinho.
const DAILY_LIMITS = { extracao: 30, duvida: 40, analise: 5 };
const LIMIT_NAMES = { extracao: 'leituras de imagem', duvida: 'dúvidas', analise: 'análises' };

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

// Cria um erro com status HTTP e uma mensagem que pode ser mostrada ao usuário
// (o tratador de erros do server.js usa error.status e error.message).
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

// ------------------------------------------------------------
// Chamada genérica ao Gemini
// ------------------------------------------------------------
// systemInstruction: regras de comportamento da IA
// input: texto, ou lista de partes ({ type: 'text', text } e { type: 'image', data, mime_type })
// schema (opcional): formato JSON obrigatório da resposta ("saída estruturada")
async function callGemini({ systemInstruction, input, schema }) {
  if (!process.env.GEMINI_API_KEY) {
    throw httpError(503, 'A IA não está configurada no servidor (falta a GEMINI_API_KEY). Veja o README.');
  }

  // Lista sem repetidos: o GEMINI_MODEL (se existir) primeiro, depois os da lista MODELS
  const models = [...new Set([process.env.GEMINI_MODEL, ...MODELS].filter(Boolean))];
  const giveUpAt = Date.now() + TOTAL_TIME_MS;
  let lastProblem = null;

  for (const model of models) {
    const timeLeft = giveUpAt - Date.now();
    if (timeLeft <= 0) break; // já tentou por 2 minutos

    const result = await sendToGemini(model, systemInstruction, input, schema, Math.min(ATTEMPT_TIMEOUT_MS, timeLeft));
    if (result.ok) {
      if (model !== models[0]) console.log(`IA respondeu com o modelo reserva ${model}`);
      return getText(result.data);
    }

    // O detalhe técnico vai para o terminal do servidor; o usuário recebe uma mensagem simples
    console.error(`Gemini (${model}) falhou: ${result.problem}`, result.data ? JSON.stringify(result.data) : '');
    lastProblem = result.problem;
    // Chave inválida ou sem permissão: trocar de modelo não adianta
    if (result.problem === 401 || result.problem === 403) break;
  }

  if (lastProblem === 429) {
    throw httpError(429, 'A cota gratuita da IA acabou por enquanto. Tente novamente mais tarde.');
  }
  if (lastProblem === 401 || lastProblem === 403) {
    throw httpError(502, 'O Google recusou a chave da IA (confira a GEMINI_API_KEY no servidor).');
  }
  if (lastProblem === 'sem conexão') {
    throw httpError(502, 'Não foi possível falar com a IA. Tente de novo.');
  }
  if (lastProblem === 503 || lastProblem === 500 || lastProblem === 'tempo esgotado') {
    throw httpError(503, 'A IA gratuita está sobrecarregada agora. Tente de novo em alguns minutos.');
  }
  throw httpError(502, 'A IA recusou o pedido. Tente de novo (detalhes no terminal do servidor).');
}

// Faz UM pedido ao Gemini com o modelo indicado.
// Devolve { ok, data, problem }, em que problem é o status HTTP do erro, 'tempo esgotado' ou 'sem conexão'.
async function sendToGemini(model, systemInstruction, input, schema, timeoutMs) {
  const body = {
    model,
    system_instruction: systemInstruction,
    input,
    store: false, // não guardar a conversa no Google: cada pedido é independente
  };
  if (schema) {
    body.response_format = { type: 'text', mime_type: 'application/json', schema };
  }

  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
        'Api-Revision': '2026-05-20', // versão da API usada nos exemplos da documentação
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs), // desiste se demorar demais
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, data, problem: response.status };
  } catch (error) {
    // AbortSignal.timeout gera um erro chamado "TimeoutError"; outros erros são falha de rede
    return { ok: false, data: null, problem: error.name === 'TimeoutError' ? 'tempo esgotado' : 'sem conexão' };
  }
}

// A resposta vem em "steps" (passos). O texto final está nos passos do tipo "model_output".
function getText(data) {
  const text = (data?.steps || [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('');

  if (!text) {
    console.error('Gemini não devolveu texto:', JSON.stringify(data));
    throw httpError(502, 'A IA não devolveu resposta. Tente de novo.');
  }
  return text;
}

// Converte a resposta da IA em objeto (quando pedimos JSON)
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('A IA não devolveu um JSON válido:', text);
    throw httpError(502, 'A IA respondeu num formato inesperado. Tente de novo.');
  }
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// ------------------------------------------------------------
// Limite diário e registro das conversas (tabela ai_interactions)
// ------------------------------------------------------------
async function checkDailyLimit(userId, kind) {
  const result = await pool.query(
    `SELECT count(*)::int AS total FROM ai_interactions
     WHERE user_id = $1 AND kind = $2 AND created_at > now() - interval '24 hours'`,
    [userId, kind]
  );
  if (result.rows[0].total >= DAILY_LIMITS[kind]) {
    throw httpError(429, `Você atingiu o limite de ${DAILY_LIMITS[kind]} ${LIMIT_NAMES[kind]} por dia. Tente amanhã.`);
  }
}

async function saveInteraction(userId, questionId, kind, userMessage, aiResponse) {
  const result = await pool.query(
    `INSERT INTO ai_interactions (user_id, question_id, kind, user_message, ai_response)
     VALUES ($1, $2, $3, $4, $5) RETURNING created_at`,
    [userId, questionId, kind, userMessage, aiResponse]
  );
  return result.rows[0].created_at;
}

// ------------------------------------------------------------
// 1) Ler uma questão a partir de uma imagem
// ------------------------------------------------------------
// Formato JSON que a IA é obrigada a devolver
const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    statement: { type: 'string' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: { letter: { type: 'string' }, text: { type: 'string' } },
        required: ['letter', 'text'],
      },
    },
    correct_letter: { type: 'string' },
    explanation: { type: 'string' },
    area: { type: 'string' },
    discipline: { type: 'string' },
    subject: { type: 'string' },
    subsubject: { type: 'string' },
    source: { type: 'string' },
  },
  required: ['found', 'statement', 'alternatives', 'correct_letter', 'explanation',
    'area', 'discipline', 'subject', 'subsubject', 'source'],
};

const EXTRACTION_RULES = `Você extrai questões de concursos públicos brasileiros a partir de imagens (prints ou fotos) e devolve JSON.

Regras:
1. statement: transcreva o enunciado completo e fiel à imagem, incluindo textos de apoio. Junte linhas quebradas no meio das frases. Não inclua o número da questão nem as alternativas.
2. alternatives: cada alternativa com a letra (A, B, C, D ou E) e o texto, sem repetir a letra no texto. No máximo 5.
   Questões de Certo ou Errado (estilo Cebraspe): use A = "Certo" e B = "Errado".
3. correct_letter: preencha SOMENTE se a imagem mostrar o gabarito (ex.: "Gabarito: C", alternativa marcada como correta, resposta destacada). Se não houver gabarito visível, use "" (vazio). NUNCA resolva a questão nem deduza a resposta.
4. explanation: preencha só se a imagem trouxer comentário ou resolução; senão "".
5. Classifique a questão: area (grande área, ex.: Direito, Matemática, Português, Informática), discipline (ex.: Direito Constitucional), subject (assunto, ex.: Direitos e Garantias Fundamentais) e subsubject (subassunto; "" se não fizer sentido).
6. source: banca, órgão, cargo e ano, se aparecerem na imagem (ex.: "FGV - TJ-RJ - 2024 - Analista Judiciário"); senão "".
7. Se a imagem não contiver uma questão legível, use found = false e deixe os outros campos vazios.
Escreva tudo em português, como está na imagem.`;

// existingNames: { areas: [], disciplines: [], subjects: [] } já usados no banco,
// para a IA reaproveitar os mesmos nomes (evita "Dir. Constitucional" e "Direito Constitucional")
async function extractQuestion(imageBase64, mimeType, existingNames) {
  const namesText = [
    `Áreas: ${existingNames.areas.join('; ') || '(nenhuma ainda)'}`,
    `Disciplinas: ${existingNames.disciplines.join('; ') || '(nenhuma ainda)'}`,
    `Assuntos: ${existingNames.subjects.join('; ') || '(nenhum ainda)'}`,
  ].join('\n');

  const text = await callGemini({
    systemInstruction: EXTRACTION_RULES,
    input: [
      { type: 'image', data: imageBase64, mime_type: mimeType },
      {
        type: 'text',
        text: `Extraia a questão desta imagem.\n\nNomes de classificação já usados no banco (reutilize exatamente quando a questão se encaixar):\n${namesText}`,
      },
    ],
    schema: QUESTION_SCHEMA,
  });

  const raw = parseJson(text);

  // Arruma o que veio da IA: as letras são refeitas pela ordem (A, B, C...) e o gabarito
  // acompanha a alternativa certa. Gabarito fora de A–E vira null ("não informado").
  const rawAlternatives = Array.isArray(raw.alternatives) ? raw.alternatives.slice(0, 5) : [];
  const correctIndex = rawAlternatives.findIndex(
    (alt) => asText(alt?.letter).toUpperCase() === asText(raw.correct_letter).toUpperCase()
  );

  return {
    found: raw.found !== false && asText(raw.statement) !== '',
    statement: asText(raw.statement),
    alternatives: rawAlternatives.map((alt) => asText(alt?.text)),
    correct_letter: asText(raw.correct_letter) && correctIndex >= 0 ? LETTERS[correctIndex] : null,
    explanation: asText(raw.explanation),
    area: asText(raw.area),
    discipline: asText(raw.discipline),
    subject: asText(raw.subject),
    subsubject: asText(raw.subsubject),
    source: asText(raw.source),
  };
}

// ------------------------------------------------------------
// 2) Tirar uma dúvida sobre uma questão
// ------------------------------------------------------------
const DOUBT_RULES = `Você é um professor experiente em concursos públicos brasileiros. Responda à dúvida do estudante sobre a questão de forma didática, objetiva e em português (no máximo cerca de 250 palavras).
- Baseie-se no enunciado e nas alternativas fornecidos.
- Se o gabarito for informado, explique por que ele está correto. Se achar que o gabarito pode estar errado, diga isso com cautela e explique o motivo.
- Se o gabarito não for informado, raciocine junto com o estudante sem afirmar certezas que você não tem.
- Cite leis, artigos ou súmulas somente se tiver certeza; nunca invente referências.
- Formato: texto simples. Pode usar **negrito** e listas com "- ". Não use títulos nem tabelas.`;

// question: { area, discipline, subject, statement, alternatives: [{letter, text}] }
// correctLetter: gabarito (só é enviado se o estudante já respondeu a questão), ou null
// selectedLetter: última resposta do estudante, ou null
// history: dúvidas anteriores [{ user_message, ai_response }]
async function answerDoubt({ question, correctLetter, selectedLetter, history, message }) {
  const lines = [
    'QUESTÃO',
    `Classificação: ${question.area} > ${question.discipline} > ${question.subject}`,
    `Enunciado: ${question.statement}`,
    'Alternativas:',
    ...question.alternatives.map((alt) => `${alt.letter}) ${alt.text}`),
    `Gabarito: ${correctLetter || 'não informado'}`,
    `Última resposta do estudante: ${selectedLetter || 'ainda não respondeu'}`,
  ];
  if (history.length > 0) {
    lines.push('', 'CONVERSA ANTERIOR');
    for (const item of history) {
      lines.push(`Estudante: ${item.user_message}`, `Professor: ${item.ai_response}`);
    }
  }
  lines.push('', `NOVA DÚVIDA DO ESTUDANTE: ${message}`);

  return callGemini({ systemInstruction: DOUBT_RULES, input: lines.join('\n') });
}

// ------------------------------------------------------------
// 3) Analisar o desempenho do usuário
// ------------------------------------------------------------
const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    difficulties: { type: 'array', items: { type: 'string' } },
    attention_subjects: { type: 'array', items: { type: 'string' } },
    study_tips: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'strengths', 'difficulties', 'attention_subjects', 'study_tips'],
};

const ANALYSIS_RULES = `Você é um orientador de estudos para concursos públicos. Analise SOMENTE os dados de desempenho fornecidos e responda em português, em JSON.
- summary: 2 ou 3 frases resumindo o desempenho geral.
- strengths: disciplinas com melhor desempenho (cite o percentual).
- difficulties: disciplinas com mais dificuldade (cite o percentual).
- attention_subjects: assuntos que precisam de mais atenção.
- study_tips: 3 a 5 sugestões de estudo práticas e específicas para esses dados.
Nunca invente números, disciplinas ou assuntos que não estejam nos dados. "respostas" são tentativas (a mesma questão pode ser respondida mais de uma vez); para falar de questões, use o campo "questoes_diferentes_resolvidas". Escreva em português natural, para o próprio estudante ("você"), e nunca copie os nomes técnicos dos campos no texto (escreva "questões diferentes", e não "questoes_diferentes_resolvidas"). Quando uma disciplina ou assunto tiver menos de 3 respostas, avise que o resultado ainda é pouco confiável. Cada item das listas deve ser uma frase curta.`;

async function analyzePerformance(data) {
  const text = await callGemini({
    systemInstruction: ANALYSIS_RULES,
    input: `Dados de desempenho do estudante (gerados a partir do banco de dados):\n${JSON.stringify(data, null, 2)}`,
    schema: ANALYSIS_SCHEMA,
  });
  const raw = parseJson(text);
  const list = (value) => (Array.isArray(value) ? value.map(asText).filter(Boolean) : []);
  return {
    summary: asText(raw.summary),
    strengths: list(raw.strengths),
    difficulties: list(raw.difficulties),
    attention_subjects: list(raw.attention_subjects),
    study_tips: list(raw.study_tips),
  };
}

module.exports = {
  callGemini,
  checkDailyLimit,
  saveInteraction,
  extractQuestion,
  answerDoubt,
  analyzePerformance,
};
