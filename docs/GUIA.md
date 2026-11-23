# Guia técnico do Gabarito

Passo a passo para rodar, configurar e publicar o projeto, e um mapa de como ele está organizado.
A apresentação do projeto está no [README](../README.md).

- [Estrutura de pastas](#estrutura-de-pastas)
- [Banco de dados](#banco-de-dados)
- [Como rodar no seu computador](#como-rodar-no-seu-computador)
- [Configurar o login com Google](#configurar-o-login-com-google)
- [Configurar a IA (Gemini, gratuito)](#configurar-a-ia-gemini-gratuito)
- [Assinar o plano PRO (demonstração)](#assinar-o-plano-pro-demonstração)
- [Testes automáticos](#testes-automáticos)
- [Publicar no Render](#publicar-no-render)
- [Rotas da API](#rotas-da-api)
- [Segurança](#segurança)
- [Problemas comuns](#problemas-comuns)
- [Limitações desta versão](#limitações-desta-versão)

## Estrutura de pastas

```
project4-2026b-cau19/
├── server.js            ← liga o Express, entrega o public/, junta as rotas e cria as tabelas ao ligar
├── database.js          ← conexão com o PostgreSQL (pool do pg)
├── auth.js              ← login Google (OAuth), cookie com o JWT, requireAuth, /api/me e /api/me/plan
├── ai.js                ← tudo que conversa com o Gemini: ler imagem, tirar dúvida, analisar desempenho
├── routes/
│   ├── questions.js     ← cadastrar, listar/filtrar, resolver, editar, apagar, dúvidas (regra PRO aqui)
│   └── stats.js         ← estatísticas e análise de desempenho
├── db/
│   ├── schema.sql       ← estrutura das 5 tabelas (o servidor roda este arquivo ao ligar)
│   ├── reset.sql        ← apaga todas as tabelas (só para recomeçar do zero)
│   └── run-sql.js       ← roda um arquivo .sql (usado pelo npm run db:reset)
├── public/              ← FRONTEND (tudo que o navegador baixa)
│   ├── index.html       ← tela de login
│   ├── dashboard.html   ← início: resumo e atalhos
│   ├── questoes.html    ← banco de questões: filtros, resolução e "Perguntar à IA"
│   ├── adicionar.html   ← upload do print + formulário de revisão (também edita: ?editar=ID)
│   ├── minhas-questoes.html
│   ├── desempenho.html  ← estatísticas, gráficos e análise com IA
│   ├── perfil.html      ← dados do usuário e plano (botão "Assinar PRO", demonstrativo)
│   ├── style.css        ← identidade visual (cores e fontes em variáveis no :root)
│   ├── favicon.svg
│   └── js/
│       ├── common.js    ← api(), escapeHtml(), cabeçalho/menu e pedaços de tela compartilhados
│       └── um arquivo por página (login.js, dashboard.js, questoes.js, ...)
├── tests/
│   ├── api.test.js      ← testes de acessos permitidos e não permitidos (npm test)
│   └── check-ai.js      ← confere se a chave da IA funciona (npm run test:ia)
├── docs/GUIA.md         ← este guia
├── demo.gif             ← demonstração usada no README
├── docker-compose.yml   ← PostgreSQL local
├── .env.example         ← modelo das variáveis de ambiente (sem segredos)
└── package.json         ← dependências e comandos
```

## Banco de dados

```
users 1 ── N questions        (cada questão tem um autor)
questions 1 ── N alternatives (de 2 a 5 alternativas, letras A–E)
users 1 ── N answers N ── 1 questions        (histórico de respostas)
users 1 ── N ai_interactions N ── 0..1 questions  (dúvidas, leituras de imagem e análises)
```

- **`questions.correct_letter` vazio (`NULL`):** significa gabarito não informado. A IA **não inventa**
  gabarito: se ele não aparece na imagem, o campo fica vazio. Uma questão sem gabarito pode ser respondida,
  mas a resposta não entra nas estatísticas.
- **`questions.is_shared = true`:** a questão fica visível para os usuários PRO.
- **`users.plan`:** `'free'` ou `'pro'`. É lido do banco a cada pedido.
- **`answers.is_correct`:** é calculado **pelo servidor**. O navegador só recebe o gabarito depois de responder.
- **`ai_interactions`:** guarda as conversas com a IA. Serve para mostrar dúvidas anteriores e para limitar
  o uso diário.
- **Imagens:** **não são guardadas**. Elas vão do navegador para o servidor e do servidor para a IA, e só o
  texto extraído é salvo.

## Como rodar no seu computador

**Pré-requisitos:** Node.js 20 ou mais recente e Docker Desktop **aberto**.

```powershell
# 1. Ligar o PostgreSQL (container "questoes-postgres", porta 5434)
docker compose up -d

# 2. Criar o arquivo de configuração a partir do modelo
copy .env.example .env
#    Abra o .env e troque o JWT_SECRET por uma chave aleatória. Para gerar uma:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Instalar as dependências
npm install

# 4. Ligar o servidor (ou "npm run dev" para reiniciar sozinho ao salvar arquivos)
npm start
```

Abra **http://localhost:3002**. O terminal deve mostrar:

```
Banco de dados conectado e tabelas conferidas.
Servidor rodando em http://localhost:3002
```

Enquanto o Google e o Gemini não estiverem configurados, aparecem dois avisos no terminal, e o botão
"Entrar com Google" mostra uma mensagem explicando o que falta.

## Configurar o login com Google

1. Acesse https://console.cloud.google.com e crie um projeto (ex.: "Gabarito").
2. Abra **APIs e serviços → Tela de consentimento OAuth** (em versões novas do painel: **Google Auth Platform**):
   - informe o nome do app, o e-mail de suporte e escolha o público **Externo**;
   - em **Público / Usuários de teste**, adicione o seu Gmail. Enquanto o app estiver em modo "Teste", **só os
     usuários de teste conseguem entrar**. Para liberar para qualquer pessoa, clique em **Publicar app**. Como o
     app só pede nome, e-mail e foto, não é preciso passar por verificação do Google.
3. Abra **Credenciais (ou Clientes) → Criar credenciais → ID do cliente OAuth**:
   - tipo: **Aplicativo da Web**;
   - em **URIs de redirecionamento autorizados** (não em "Origens JavaScript autorizadas"), adicione exatamente:
     - `http://localhost:3002/auth/google/callback`
     - `https://SEU-APP.onrender.com/auth/google/callback` (depois de criar o app no Render).
4. Copie o **ID do cliente** e a **Chave secreta do cliente** para o `.env`:
   ```
   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-....
   ```
5. Reinicie o servidor e clique em **Entrar com Google**.

> Se aparecer `redirect_uri_mismatch`, o endereço cadastrado no Google não é idêntico a `APP_URL` +
> `/auth/google/callback`. Confira `http`/`https`, a porta e a barra no final. Mudanças no Google podem levar
> alguns minutos para valer.

## Configurar a IA (Gemini, gratuito)

1. Acesse https://aistudio.google.com/apikey e clique em **Criar chave de API**. Não é preciso cartão.
2. Cole a chave no `.env`: `GEMINI_API_KEY=...`
3. Teste com `npm run test:ia`. Deve aparecer `OK: a IA está funcionando.` Se der erro, o motivo aparece no terminal.

Sobre o plano gratuito do Gemini:

- **Limites:** o plano gratuito tem limites de pedidos por minuto e por dia, que valem para o projeto inteiro.
  Por isso o app também limita cada usuário, a cada 24 horas, a 30 leituras de imagem, 40 dúvidas e 5
  análises (`DAILY_LIMITS` em [ai.js](../ai.js)).
- **Privacidade:** no plano gratuito, o Google pode usar o conteúdo enviado para melhorar os produtos dele.
  Não envie dados pessoais para a IA.
- **Modelos:** o app tenta, nesta ordem: `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-3.6-flash`,
  `gemini-3.1-flash-lite` e `gemini-4-hydrogen` (lista `MODELS` em [ai.js](../ai.js)).
  - **Quando pula para o próximo:** se um modelo responder "sobrecarregado" (503), "sem cota" (429) ou
    demorar mais de 60 s.
  - **Quando desiste:** depois de 2 minutos no total, mostrando uma mensagem amigável.
  - **Mudar o primeiro da lista:** defina `GEMINI_MODEL` no `.env`.
  - **Modelos gratuitos atuais:** https://ai.google.dev/gemini-api/docs/pricing.

### Se a IA gratuita estiver sempre "sobrecarregada"

No plano gratuito, o Google atende por último. Em horário de pico, **todos** os modelos gratuitos podem
recusar os pedidos, e nenhuma mudança no código resolve isso. A solução é ativar o faturamento **na mesma
chave**, sem mudar o código:

1. Em https://aistudio.google.com/apikey, clique em **Set up billing** (ou "Configurar faturamento") ao lado
   do projeto da chave. Vincule uma conta de faturamento do Google Cloud (cartão). O projeto sobe para o
   nível pago na hora.
2. No Render, em **Environment**, crie `GEMINI_MODEL=gemini-3.5-flash-lite`. Ele é o modelo mais barato da
   lista e já foi testado com o app. Assim ele vira o primeiro a ser tentado.
3. Crie um **alerta de gasto**: Google Cloud Console → **Faturamento → Orçamentos e alertas** → um orçamento
   pequeno (ex.: R$ 10) com avisos em 50%, 90% e 100%. Atenção: o alerta só **avisa**, não bloqueia.

Custo estimado com o `gemini-3.5-flash-lite` pago (US$ 0,30 por milhão de tokens de entrada e US$ 2,50 por
milhão de saída): cerca de US$ 0,002 a 0,006 por questão lida, ou seja, centavos para algumas dezenas de
questões. No plano pago, o Google **não** usa o conteúdo enviado para treinar os modelos.

## Assinar o plano PRO (demonstração)

Não há pagamento de verdade. Na página **Perfil**:

- O botão **Assinar PRO** abre uma janela de confirmação avisando que é uma demonstração: nada é cobrado e
  nenhum dado bancário é pedido.
- Ao confirmar, o navegador chama `PUT /api/me/plan` e o servidor muda o plano **do próprio usuário logado**.
- O botão **Voltar ao plano gratuito** desfaz a mudança.

A mudança vale no próximo clique, sem sair e entrar de novo, porque o plano é lido do banco a cada pedido.

## Testes automáticos

Com o servidor ligado num terminal, rode em outro:

```powershell
npm test
```

São 20 testes de acessos **permitidos** e **não permitidos**:

- sem login;
- crachá falsificado;
- usuário gratuito tentando ver, responder ou perguntar sobre questões compartilhadas;
- usuário PRO tentando ver questões particulares de outros;
- edição e exclusão só pelo autor;
- correção feita pelo servidor;
- troca de plano: só aceita valores válidos, e o acesso muda na hora;
- estatísticas.

Como o login real é pelo Google, os testes criam usuários temporários direto no banco e assinam o crachá
com o mesmo `JWT_SECRET` do servidor. No final, esses usuários são apagados, e as questões deles somem junto.

### Rodar os testes contra o site publicado

Para testar o site no Render, o seu computador precisa usar o **mesmo banco** e a **mesma chave** que o
Render usa. Abra o site no navegador antes, para ele "acordar", e rode no PowerShell:

```powershell
$env:BASE_URL="https://SEU-APP.onrender.com"
$env:DATABASE_URL="postgres://..."   # External Database URL (página do banco no Render)
$env:JWT_SECRET="..."                # o mesmo JWT_SECRET do Web Service no Render
npm test
Remove-Item Env:BASE_URL, Env:DATABASE_URL, Env:JWT_SECRET
```

As variáveis definidas no terminal têm prioridade sobre o `.env`, porque o `dotenv` não sobrescreve o que já
existe. A última linha apaga essas variáveis, para o terminal voltar a usar o banco local.

### Recomeçar o banco do zero

```powershell
npm run db:reset    # apaga TODAS as tabelas e dados
npm start           # o servidor recria as tabelas vazias
```

## Publicar no Render

### 1. Enviar o código para o GitHub

```powershell
git add .
git commit -m "Banco de questões: versão inicial"
git push
```

O `.gitignore` impede que o `.env` e o `node_modules/` sejam enviados. **Nunca** coloque chaves no código.

### 2. Criar o banco PostgreSQL

1. No painel do Render (https://dashboard.render.com): **New → Postgres**.
2. Dê um nome (ex.: `gabarito-db`), escolha a região (ex.: Ohio) e o plano **Free**.
3. Depois de criado, copie a **Internal Database URL**.

> O PostgreSQL gratuito do Render tem prazo de validade. Veja no painel do banco a data em que ele expira.

### 3. Criar o Web Service

1. **New → Web Service** e conecte o repositório do GitHub.
2. Configure:
   - **Region:** a **mesma** do banco. A Internal URL só funciona na mesma região.
   - **Runtime:** Node.
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** Free.
   - Em **Advanced → Health Check Path:** `/api/health`
3. Em **Environment Variables**, adicione:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a Internal Database URL do passo 2 |
| `JWT_SECRET` | uma chave aleatória **diferente** da local (o Render tem o botão "Generate") |
| `APP_URL` | `https://SEU-APP.onrender.com` (o endereço que o Render mostra, sem barra no final) |
| `GOOGLE_CLIENT_ID` | o mesmo do `.env` |
| `GOOGLE_CLIENT_SECRET` | o mesmo do `.env` |
| `GEMINI_API_KEY` | a mesma do `.env` |

Não defina `PORT`: o Render escolhe a porta e o servidor usa a que ele informar.

4. Clique em **Create Web Service**. No log do deploy devem aparecer `Banco de dados conectado e tabelas
   conferidas.` e `Servidor rodando...`. As tabelas são criadas sozinhas.

### 4. Cadastrar o endereço do Render no Google

No Google Cloud Console, no mesmo cliente OAuth, adicione o URI de redirecionamento
`https://SEU-APP.onrender.com/auth/google/callback`. O de localhost continua lá, assim o login funciona nos
dois lugares.

### 5. Testar online

1. Abra `https://SEU-APP.onrender.com/api/health`. Deve aparecer `{"status":"ok",...}`.
2. Entre com o Google, cadastre uma questão por imagem, resolva, pergunte à IA, confira o Desempenho e teste
   o botão **Assinar PRO** no Perfil.
3. Rode os testes automáticos contra o site publicado (seção [Testes automáticos](#rodar-os-testes-contra-o-site-publicado)).
4. Coloque a URL no README (seção "Acesso") e na seção "About" do repositório no GitHub.

> No plano gratuito, o Render "dorme" depois de 15 minutos sem acesso. O primeiro carregamento depois disso
> pode levar cerca de 1 minuto.

## Rotas da API

| Método e rota | O que faz | Quem pode |
|---|---|---|
| `GET /api/health` | confere se o servidor está no ar | todos |
| `GET /auth/google` · `GET /auth/google/callback` | login com Google | todos |
| `POST /auth/logout` | sair (apaga o cookie) | todos |
| `GET /api/me` | dados e plano do usuário logado | logado |
| `PUT /api/me/plan` | troca o próprio plano (assinatura demonstrativa) | logado |
| `POST /api/questions/extract` | imagem → IA → prévia em JSON (não salva) | logado |
| `POST /api/questions` | salva uma questão revisada | logado |
| `GET /api/questions?scope=&area=&discipline=&subject=&search=` | lista com filtros | regra de acesso¹ |
| `GET /api/questions/filters` | opções dos filtros | regra de acesso¹ |
| `GET /api/questions/:id` | uma questão, **sem** gabarito | regra de acesso¹ |
| `POST /api/questions/:id/answer` | corrige, grava no histórico e devolve gabarito e explicação | regra de acesso¹ |
| `GET` e `POST /api/questions/:id/doubts` | dúvidas com IA | regra de acesso¹ |
| `PUT` e `DELETE /api/questions/:id` | editar e apagar | só o autor |
| `GET /api/me/questions` · `GET /api/me/questions/:id` | minhas questões (com gabarito, para editar) | só o autor |
| `GET /api/stats` | totais, por disciplina, por dia e histórico | logado (só os próprios dados) |
| `GET` e `POST /api/stats/analysis` | última análise e nova análise com IA | logado (só os próprios dados) |

¹ **Regra de acesso:** o usuário vê a questão se for o **autor** **ou** se ela for **compartilhada** e ele for
**PRO**. Ela está na constante `CAN_SEE` em [routes/questions.js](../routes/questions.js) e entra no `WHERE`
de toda consulta que lê questões. O plano vem do banco (`req.user.plan`), nunca do navegador.

## Segurança

- **Chaves:** as chaves do Google e do Gemini ficam só no servidor, em variáveis de ambiente.
- **Sessão:** o crachá de login fica num cookie `httpOnly` (o JavaScript da página não consegue ler) e
  `sameSite=lax` (protege contra pedidos forjados por outros sites). Em `https`, o cookie também é `secure`.
- **Login com Google:** usa o parâmetro `state` contra logins injetados.
- **SQL:** todas as consultas são parametrizadas (`$1`, `$2`...), contra SQL injection.
- **HTML:** todo texto vindo do servidor passa por `escapeHtml()` antes de ir para a tela, contra XSS. Isso é
  importante porque questões compartilhadas têm textos de outras pessoas. As respostas da IA também são
  escapadas antes de virar **negrito**, *itálico* e listas.
- **Erros:** "não existe" e "sem permissão" devolvem a mesma resposta (404), para ninguém descobrir questões
  alheias testando números.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `Não foi possível ligar o servidor ... docker compose up -d` | O Docker Desktop está fechado ou o container está parado |
| `EADDRINUSE` | Já existe outro servidor na porta 3002 (um `npm start` esquecido em outro terminal) |
| `redirect_uri_mismatch` no Google | O URI cadastrado no Google é diferente de `APP_URL` + `/auth/google/callback` |
| "Acesso bloqueado: o app não concluiu a verificação" | O app está em modo Teste no Google e o seu e-mail não está em "Usuários de teste" |
| "A IA não está configurada" | Falta `GEMINI_API_KEY` no `.env` ou no Render |
| "A IA está sobrecarregada no momento" | Os modelos gratuitos do Gemini estão com alta demanda. Espere alguns instantes e tente de novo |
| "A cota gratuita da IA acabou por enquanto" | Limite do plano gratuito do Gemini. Espere e tente de novo |

## Limitações desta versão

- Não há pagamento: o botão **Assinar PRO** é demonstrativo, e qualquer usuário logado pode ativá-lo. Numa
  versão real, a rota `PUT /api/me/plan` daria lugar à confirmação de um serviço de pagamento.
- As imagens não são guardadas, então figuras e gráficos de uma questão não aparecem depois, só o texto. Para
  guardá-las, seria preciso um serviço externo de arquivos, como Cloudinary ou Supabase Storage.
- A lista mostra até 100 questões por vez. Use os filtros para refinar.
- O plano gratuito do Gemini pode ficar sobrecarregado em horários de pico; o app tenta de novo
  automaticamente, mas às vezes é preciso esperar.
