// ============================================================
// IA: todas as conversas com as IAs ficam neste arquivo
// ============================================================
// O app usa SÓ planos gratuitos, de três serviços, com fetch puro (sem biblioteca):
//   - Groq        (rápido; 1.000 pedidos por dia no plano grátis)
//   - OpenRouter  (modelos ":free"; 50 pedidos por dia no plano grátis)
//   - Gemini      (Google; em horário de pico costuma ficar "sobrecarregado")
// Cada serviço só é usado se a chave dele estiver configurada (.env ou painel do Render).
// Se um falhar (sobrecarregado, sem cota, lento demais), o app tenta o próximo.
// As chaves ficam só aqui no servidor: o navegador nunca as vê.
// Planos gratuitos podem registrar o que é enviado: não envie dados pessoais para a IA.

const pool = require('./database');

// Endereço e nome da variável com a chave de cada serviço.
// Groq e OpenRouter usam o mesmo formato de pedido (o do OpenAI); o Gemini tem formato próprio.
const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', keyName: 'GROQ_API_KEY' },
  openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', keyName: 'OPENROUTER_API_KEY' },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/interactions', keyName: 'GEMINI_API_KEY' },
};

// Ordem das tentativas (todos os modelos são gratuitos e leem imagens, em nov/2026).
// A variável GEMINI_MODEL (opcional, para quem ativar o faturamento do Gemini) coloca esse modelo em 1º.
const ATTEMPTS = [
  { provider: 'groq', model: 'qwen/qwen3.8-27b' },
  { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
  { provider: 'openrouter', model: 'nvidia/nemotron-3.5-super-vl:free' },
  { provider: 'gemini', model: 'gemini-3.8-flash' },
  { provider: 'gemini', model: 'gemini-3.5-flash-lite' },
  { provider: 'gemini', model: 'gemini-3.6-flash' },
  { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
  { provider: 'gemini', model: 'gemini-4-hydrogen' },
];
const ATTEMPT_TIMEOUT_MS = 60000; // cada tentativa tem até 60 s para responder
const TOTAL_TIME_MS = 120000;     // depois de 2 minutos tentando, desiste

// Limite de usos por usuário a cada 24 horas. As cotas gratuitas são do PROJETO
// inteiro (compartilhadas por todos os usuários), então ninguém pode gastá-las sozinho.
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
// Chamada genérica à IA (tenta os serviços na ordem de ATTEMPTS)
// ------------------------------------------------------------
// systemInstruction: regras de comportamento da IA
// input: texto, ou lista de partes ({ type: 'text', text } e { type: 'image', data, mime_type })
// schema (opcional): formato JSON obrigatório da resposta
async function callAI({ systemInstruction, input, schema }) {
  // Só entram as tentativas dos serviços que têm chave configurada
  const extra = process.env.GEMINI_MODEL ? [{ provider: 'gemini', model: process.env.GEMINI_MODEL }] : [];
  const attempts = [...extra, ...ATTEMPTS].filter((a) => process.env[PROVIDERS[a.provider].keyName]);
  if (attempts.length === 0) {
    throw httpError(503, 'A IA não está configurada no servidor (falta GROQ_API_KEY, OPENROUTER_API_KEY ou GEMINI_API_KEY). Veja o README.');
  }

  const giveUpAt = Date.now() + TOTAL_TIME_MS;
  const rejectedKeys = new Set(); // serviços que recusaram a chave: não adianta tentar outros modelos deles
  const problems = [];

  // Faz uma tentativa no serviço certo, respeitando o tempo que ainda resta
  const send = (provider, model) => {
    const timeout = Math.max(1000, Math.min(ATTEMPT_TIMEOUT_MS, giveUpAt - Date.now()));
    return provider === 'gemini'
      ? sendToGemini(model, systemInstruction, input, schema, timeout)
      : sendToOpenAICompatible(provider, model, systemInstruction, input, schema, timeout);
  };

  for (const { provider, model } of attempts) {
    if (rejectedKeys.has(provider)) continue;
    if (giveUpAt - Date.now() <= 0) break; // já tentou por 2 minutos

    let result = await send(provider, model);

    // "Limite por minuto": o serviço avisa quantos segundos esperar (o Groq costuma pedir de 5 a 10 s).
    // Se for pouco, vale esperar e tentar mais UMA vez no mesmo modelo, em vez de ir para um reserva pior.
    const wait = result.retryAfter;
    if (!result.ok && result.problem === 429 && wait > 0 && wait <= 20 && Date.now() + wait * 1000 < giveUpAt) {
      console.log(`IA ${provider} (${model}) pediu ${wait} s de espera; tentando de novo...`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000 + 500));
      result = await send(provider, model);
    }

    if (result.ok && result.text) {
      console.log(`IA respondeu: ${provider} (${model})`);
      return result.text;
    }

    // O detalhe técnico vai para o terminal do servidor; o usuário recebe uma mensagem simples
    const problem = result.ok ? 'resposta vazia' : result.problem;
    console.error(`IA ${provider} (${model}) falhou: ${problem}`, result.detail || '');
    problems.push(problem);
    if (problem === 401 || problem === 403) rejectedKeys.add(provider);
  }

  if (problems.length > 0 && problems.every((p) => p === 401 || p === 403)) {
    throw httpError(502, 'As chaves das IAs foram recusadas. Confira as variáveis de ambiente do servidor.');
  }
  if (problems.length > 0 && problems.every((p) => p === 'sem conexão')) {
    throw httpError(502, 'Não foi possível falar com a IA. Tente de novo.');
  }
  throw httpError(503, 'As IAs gratuitas estão sobrecarregadas ou sem cota agora. Tente de novo em alguns minutos.');
}

// Faz UM pedido ao Gemini (Interactions API).
// Devolve { ok, text } ou { ok: false, problem, detail }, em que problem é o status HTTP,
// 'tempo esgotado' ou 'sem conexão'.
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
    const response = await fetch(PROVIDERS.gemini.url, {
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
    if (!response.ok) return { ok: false, problem: response.status, detail: JSON.stringify(data) };

    // A resposta vem em "steps" (passos). O texto final está nos passos do tipo "model_output".
    const text = (data?.steps || [])
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content || [])
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('');
    return { ok: true, text: text.trim() };
  } catch (error) {
    // AbortSignal.timeout gera um erro chamado "TimeoutError"; outros erros são falha de rede
    return { ok: false, problem: error.name === 'TimeoutError' ? 'tempo esgotado' : 'sem conexão' };
  }
}

// Faz UM pedido a um serviço no formato do OpenAI (Groq e OpenRouter).
async function sendToOpenAICompatible(provider, model, systemInstruction, input, schema, timeoutMs) {
  // Converte o nosso "input" para o formato de mensagens do OpenAI.
  // A imagem vai como "data URL": data:image/jpeg;base64,AAAA...
  const parts = typeof input === 'string' ? [{ type: 'text', text: input }] : input;
  const content = parts.map((part) => (part.type === 'image'
    ? { type: 'image_url', image_url: { url: `data:${part.mime_type};base64,${part.data}` } }
    : { type: 'text', text: part.text }));

  // Para JSON: liga o "modo JSON" e descreve o formato nas instruções
  // (nem todo modelo gratuito aceita receber o esquema separado, mas todos entendem a descrição)
  const instructions = schema
    ? `${systemInstruction}\n\nResponda SOMENTE com um objeto JSON válido, sem nenhum texto antes ou depois, seguindo este JSON Schema:\n${JSON.stringify(schema)}`
    : systemInstruction;

  const body = {
    model,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content },
    ],
  };
  if (schema) body.response_format = { type: 'json_object' };

  try {
    const response = await fetch(PROVIDERS[provider].url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env[PROVIDERS[provider].keyName]}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = JSON.stringify(data);
      // Quantos segundos esperar: vem no cabeçalho "retry-after" ou na mensagem ("try again in 5.02s")
      const fromMessage = /try again in ([\d.]+)\s*s/i.exec(detail || '');
      const retryAfter = Math.ceil(Number(response.headers.get('retry-after')) || Number(fromMessage?.[1]) || 0);
      return { ok: false, problem: response.status, detail, retryAfter };
    }

    // Alguns modelos "pensam em voz alta" entre <think> e </think>: tiramos essa parte
    const text = String(data?.choices?.[0]?.message?.content || '')
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();
    return { ok: true, text };
  } catch (error) {
    return { ok: false, problem: error.name === 'TimeoutError' ? 'tempo esgotado' : 'sem conexão' };
  }
}

// Converte a resposta da IA em objeto (quando pedimos JSON).
// Alguns modelos embrulham o JSON em ```json ... ```: pegamos só do primeiro "{" ao último "}".
function parseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  try {
    return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
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

  const text = await callAI({
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

  return callAI({ systemInstruction: DOUBT_RULES, input: lines.join('\n') });
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
  const text = await callAI({
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
  callAI,
  checkDailyLimit,
  saveInteraction,
  extractQuestion,
  answerDoubt,
  analyzePerformance,
};
