# Guia técnico do Gabarito

Passo a passo para rodar, configurar e publicar o projeto, e um mapa de como ele está organizado.
A apresentação do projeto está no [README](../README.md).

- [Estrutura de pastas](#estrutura-de-pastas)
- [Banco de dados](#banco-de-dados)
- [Como rodar no seu computador](#como-rodar-no-seu-computador)
- [Configurar o login com Google](#configurar-o-login-com-google)
- [Configurar as IAs (gratuitas)](#configurar-as-ias-gratuitas)
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
├── ai.js                ← tudo que conversa com as IAs (Groq, OpenRouter, Gemini): ler imagem, dúvida, análise
├── routes/
│   ├── questions.js     ← cadastrar, listar/filtrar, resolver, editar, apagar, dúvidas (regra PRO aqui)
│   └── stats.js         ← estatísticas e análise de desempenho
├── db/
│   ├── schema.sql       ← estrutura das 5 tabelas (o servidor roda este arquivo ao ligar)
│   ├── reset.sql        ← apaga todas as tabelas (só para recomeçar do zero)
│   ├── run-sql.js       ← roda um arquivo .sql (usado pelo npm run db:reset)
│   ├── exemplos.js      ← coloca 20 questões de exemplo no banco (npm run db:exemplos)
│   └── exemplos.json    ← as 20 questões de exemplo (inéditas, com gabarito e explicação)
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

Enquanto o Google e as IAs não estiverem configurados, aparecem dois avisos no terminal, e o botão
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

## Configurar as IAs (gratuitas)

O app usa **três serviços de IA gratuitos**, nesta ordem: **Groq → OpenRouter → Gemini**. Configure pelo
menos um. Com mais de um, quando o primeiro estiver sobrecarregado ou sem cota, o app passa sozinho para o
próximo. Todos são gratuitos, e nenhum pede cartão.

| Serviço | Onde criar a chave | Variável | Plano grátis | Modelo usado (lê imagens) |
|---|---|---|---|---|
| **Groq** | https://console.groq.com/keys → **Create API Key** (começa com `gsk_`) | `GROQ_API_KEY` | 30 pedidos/min, 1.000/dia | `qwen/qwen3.8-27b` |
| **OpenRouter** | https://openrouter.ai/settings/keys → **Create Key** (começa com `sk-or-`) | `OPENROUTER_API_KEY` | 20 pedidos/min, 50/dia | `google/gemma-4-31b-it:free` e `nvidia/nemotron-3.5-super-vl:free` |
| **Gemini** | https://aistudio.google.com/apikey → **Criar chave de API** | `GEMINI_API_KEY` | varia; fica sobrecarregado no pico | 5 modelos (`gemini-3.8-flash`, `gemini-3.5-flash-lite`...) |

1. Crie as chaves (dá para entrar com a conta Google ou GitHub em todos).
2. Cole no `.env`, por exemplo `GROQ_API_KEY=gsk_...`, e no Render, em **Environment**, com os mesmos nomes.
3. Teste com `npm run test:ia`. O terminal mostra qual serviço respondeu (`IA respondeu: groq (...)`) e
   termina com `OK: a IA está funcionando.`

Como funciona a troca (lista `ATTEMPTS` em [ai.js](../ai.js)):

- **Quando pula para o próximo:** se um modelo responder "sobrecarregado" (503), "sem cota" (429) ou
  demorar mais de 60 s.
- **Chave recusada:** se um serviço recusar a chave (401/403), os outros modelos desse mesmo serviço são pulados.
- **Quando desiste:** depois de 2 minutos no total, mostrando uma mensagem amigável.
- **Limite por usuário:** como as cotas gratuitas valem para o projeto inteiro, o app também limita cada
  usuário, a cada 24 horas, a 30 leituras de imagem, 40 dúvidas e 5 análises (`DAILY_LIMITS` em [ai.js](../ai.js)).
- **`GEMINI_MODEL` (opcional):** coloca um modelo do Gemini **antes de todos**. É útil se você ativar o
  faturamento do Gemini.

Cuidados:

- **Privacidade:** planos gratuitos podem registrar o que é enviado. O Groq diz que, por padrão, não guarda
  os pedidos. Nos modelos `:free` do OpenRouter e no Gemini gratuito, o conteúdo pode ser usado pelos
  provedores. Não envie dados pessoais para a IA.
- **OpenRouter:** se o teste mostrar um erro sobre *data policy*, abra **Settings → Privacy** e permita os
  provedores dos modelos gratuitos.
- **Modelos mudam:** se um modelo deixar de existir, o app simplesmente pula para o próximo. Para atualizar a
  lista, veja os modelos gratuitos com imagem em https://openrouter.ai/models, https://console.groq.com/docs/vision
  e https://ai.google.dev/gemini-api/docs/pricing.

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

### Questões de exemplo

Para o banco não começar vazio, há 20 questões inéditas, com gabarito e explicação: Direito, Português,
Matemática, Raciocínio Lógico e Informática. Entre no site com o Google pelo menos uma vez e rode:

```powershell
npm run db:exemplos -- seu@email.com
```

- **12 ficam como suas** (particulares): você vê e resolve mesmo no plano gratuito.
- **8 são do autor de exemplo "Gabarito Exemplos"**, compartilhadas: só aparecem para quem é PRO. É assim que
  dá para demonstrar o banco compartilhado.
- Pode rodar de novo sem duplicar nada.

Para colocar as questões no banco do **Render**, use a External Database URL antes do comando:

```powershell
$env:DATABASE_URL="postgres://... (External Database URL)"; npm run db:exemplos -- seu@email.com
Remove-Item Env:DATABASE_URL
```

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
| `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` | as mesmas do `.env` (pelo menos uma) |

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

- **Chaves:** as chaves do Google e das IAs ficam só no servidor, em variáveis de ambiente.
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
| "A IA não está configurada" | Falta pelo menos uma chave de IA (`GROQ_API_KEY`, `OPENROUTER_API_KEY` ou `GEMINI_API_KEY`) no `.env` ou no Render |
| "As IAs gratuitas estão sobrecarregadas ou sem cota" | Todos os serviços configurados falharam. Configure mais de um (Groq + OpenRouter + Gemini) ou espere alguns minutos |

## Limitações desta versão

- Não há pagamento: o botão **Assinar PRO** é demonstrativo, e qualquer usuário logado pode ativá-lo. Numa
  versão real, a rota `PUT /api/me/plan` daria lugar à confirmação de um serviço de pagamento.
- As imagens não são guardadas, então figuras e gráficos de uma questão não aparecem depois, só o texto. Para
  guardá-las, seria preciso um serviço externo de arquivos, como Cloudinary ou Supabase Storage.
- A lista mostra até 100 questões por vez. Use os filtros para refinar.
- As IAs gratuitas podem ficar sobrecarregadas ou sem cota em horários de pico. Com mais de um serviço
  configurado (Groq, OpenRouter e Gemini), o app troca sozinho, mas às vezes ainda é preciso esperar.
