-- Estrutura completa do banco do Banco de Questões.
-- O servidor roda este arquivo toda vez que liga: por isso tudo usa "if not exists"
-- (se a tabela já existe, nada acontece e os dados continuam lá).
--
-- Como os dados se relacionam:
--   users 1 ── N questions         (cada questão tem um autor)
--   questions 1 ── N alternatives  (cada questão tem de 2 a 5 alternativas)
--   users 1 ── N answers N ── 1 questions        (histórico: quem respondeu o quê)
--   users 1 ── N ai_interactions N ── 0..1 questions  (conversas com a IA)

-- Usuários. Não existe senha: quem confere a identidade é o Google.
create table if not exists users (
  id bigint generated always as identity primary key,
  google_id text not null unique,          -- identificador fixo que o Google dá para a conta ("sub")
  name text not null,
  email text not null unique,
  picture_url text,                        -- foto do perfil Google
  plan text not null default 'free' check (plan in ('free', 'pro')),
  created_at timestamptz not null default now()
);

-- Questões. "on delete cascade": se o autor for apagado, as questões dele somem junto.
create table if not exists questions (
  id bigint generated always as identity primary key,
  author_id bigint not null references users(id) on delete cascade,
  statement text not null,                 -- enunciado
  area text not null,                      -- ex.: Direito
  discipline text not null,                -- ex.: Direito Constitucional
  subject text not null,                   -- assunto, ex.: Direitos Fundamentais
  subsubject text,                         -- subassunto (opcional)
  correct_letter text check (correct_letter in ('A', 'B', 'C', 'D', 'E')),  -- NULL = gabarito não informado
  explanation text,                        -- explicação/comentário (opcional)
  source text,                             -- origem: banca, órgão, ano, link...
  is_shared boolean not null default false, -- true = visível para usuários PRO
  created_at timestamptz not null default now()
);

create index if not exists questions_author_id_idx on questions (author_id);

-- Alternativas. O "unique" impede duas alternativas com a mesma letra na mesma questão
-- (e também cria um índice que deixa rápido buscar "as alternativas da questão X").
create table if not exists alternatives (
  id bigint generated always as identity primary key,
  question_id bigint not null references questions(id) on delete cascade,
  letter text not null check (letter in ('A', 'B', 'C', 'D', 'E')),
  text text not null,
  unique (question_id, letter)
);

-- Respostas (histórico). Cada tentativa vira uma linha; is_correct é calculado pelo SERVIDOR.
create table if not exists answers (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  question_id bigint not null references questions(id) on delete cascade,
  selected_letter text not null check (selected_letter in ('A', 'B', 'C', 'D', 'E')),
  is_correct boolean not null,
  answered_at timestamptz not null default now()
);

create index if not exists answers_user_id_idx on answers (user_id);

-- Conversas com a IA. Servem para mostrar dúvidas anteriores e para limitar o uso diário.
-- "on delete set null": se a questão for apagada, o registro fica, só perde o vínculo.
create table if not exists ai_interactions (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  question_id bigint references questions(id) on delete set null,
  kind text not null check (kind in ('extracao', 'duvida', 'analise')),
  user_message text,                       -- dúvida digitada (vazio na extração e na análise)
  ai_response text,                        -- resposta da IA (texto ou JSON)
  created_at timestamptz not null default now()
);

create index if not exists ai_interactions_user_idx on ai_interactions (user_id, kind, created_at);
