# PayFlow | Configuracao e operacao

## Arquitetura

- Web: React, Vite e Supabase Auth.
- Dados: Supabase Postgres com RLS para clientes, links, cobrancas e documentos.
- API: Fastify; valida sessao Supabase, aplica allowlist para cobrancas e guarda credenciais do Poseidon somente no servidor.
- Pix: o valor de um checkout vem do link persistido no Supabase; o comprador nao consegue modifica-lo no navegador.

O app nao inicializa registros de exemplo. Sem configuracao Supabase, mostra a tela de conexao e nao exibe informacoes financeiras ficticias.

## Pre-requisitos

- Node.js 20+ e npm.
- Projeto Supabase com Auth e Postgres habilitados.
- Credenciais de API Poseidon de uma conta autorizada para Pix.

## Configurar Supabase

1. Crie ou selecione um projeto Supabase.
2. No SQL Editor do projeto, execute [20261028000001_gateway_tables.sql](../supabase/migrations/20261028000001_gateway_tables.sql). A migration cria as tabelas e politicas RLS.
3. Copie os templates locais:

```powershell
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env
```

4. No `apps/web/.env`, configure a URL do projeto e a chave publica anon:

```env
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON
```

5. No `.env` da raiz, configure os valores do servidor:

```env
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_ANON_KEY=SUA_CHAVE_ANON
SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE
POSEIDON_API_URL=https://app.poseidonpay.site/api/v1/gateway/pix/receive
POSEIDON_PUBLIC_KEY=SUA_CHAVE_PUBLICA_POSEIDON
POSEIDON_SECRET_KEY=SUA_CHAVE_SECRETA_POSEIDON
PAYFLOW_ALLOWED_EMAILS=seu-email@empresa.com
```

`PAYFLOW_ALLOWED_EMAILS` e uma lista separada por virgulas. Apenas esses usuarios autenticados podem criar cobrancas pelo painel. A service role e a chave secreta Poseidon nunca devem ser colocadas no `.env` do frontend nem enviadas ao navegador.

Se ja existir um `.env`, o `Copy-Item` nao o sobrescreve. Edite-o manualmente. Os valores do exemplo sao placeholders, nao credenciais validas.

Depois de criar e confirmar sua conta pelo formulario do app, execute no Supabase SQL Editor o provisionamento do operador usando o e-mail real da sua conta:

```sql
insert into public.payflow_operators (user_id)
select id from auth.users where lower(email) = lower('seu-email@empresa.com')
on conflict (user_id) do nothing;
```

O e-mail tambem precisa constar em `PAYFLOW_ALLOWED_EMAILS` no `.env` do backend. Sem as duas configuracoes, o painel nao consegue ler dados e a API nao autoriza cobrancas.

## Iniciar localmente no Windows

```powershell
npm install
npm run dev --workspace @payflow/api
```

Em outro terminal:

```powershell
npm run dev --workspace @payflow/web
```

A web abre na porta indicada pelo Vite, normalmente `http://localhost:5173`. A API fica em `http://localhost:3333`; verifique `/health`.

O script `setup-local.ps1` copia os templates que ainda nao existirem e inicia os dois servicos. Ele nao aplica migrations automaticamente nem cria usuarios de exemplo.

## Entrar e operar

1. Crie uma conta ou entre pelo formulario Supabase Auth.
2. Confirme o e-mail caso a politica de Auth do projeto exija.
3. Cadastre clientes e links de pagamento; os dados ficam nas tabelas do Supabase protegidas por RLS.
4. Crie uma cobranca Pix para um cliente autorizado ou compartilhe um link.
5. O backend valida o pedido, cria uma linha pendente, chama o Poseidon e armazena transaction ID, taxa, codigo Pix e expiracao.
6. Copie o codigo Pix para pagar. A cobranca nao e marcada como concluida pelo navegador.
7. Em “Visao geral”, use “Depositar via Pix” para gerar uma solicitacao Pix com seus dados. Ela aparece como pendente e nao credita saldo no PayFlow.

Uma resposta do endpoint de criacao pode representar apenas uma cobranca pendente. Guarde o `transactionId`, o `chargeId` e o codigo copia-e-cola.

## API

### Criar cobranca Pix autenticada

`POST /api/v1/gateway/pix/receive`

Envie `Authorization: Bearer <access_token_supabase>` e o payload Pix documentado pelo Poseidon. O e-mail do usuario deve estar em `PAYFLOW_ALLOWED_EMAILS`. O servidor usa as credenciais Poseidon de `.env` e persiste o resultado no Supabase.

### Checkout Pix por link

`POST /api/v1/checkout/:linkId/pix`

Este endpoint publico recebe apenas `identifier` (UUID) e dados do cliente. Nome e valor do produto sao carregados do link no Supabase; link ausente/inativo retorna `404`. As chaves do adquirente nao passam pelo browser.

## Estado e seguranca

- RLS restringe leitura e escrita de clientes/links/documentos ao usuario autenticado.
- Cobrancas sao somente leitura para o cliente web; apenas a service role do servidor grava status retornado do provedor.
- Nao armazene cartao, CVV ou credenciais do adquirente no frontend.
- Configure HTTPS, allowlist, rotacao de chaves, backups, logs sem PII/secrets e alertas antes de expor a API.

## O que falta para operacao financeira completa

- Integrar e validar o webhook oficial do Poseidon para atualizar status depois do pagamento. A documentacao enviada informa um `webhookToken`, mas nao descreve o formato/assinatura do callback; nao e seguro adivinhar esse contrato.
- Configurar URL publica HTTPS para o callback e idempotencia/reconciliacao.
- Integrar um provedor bancario para consultar saldo e executar repasses.
- Implementar carteira/credito de saldo somente depois de integrar e validar a confirmacao oficial do deposito.
- Integrar um provedor fiscal autorizado para NFS-e.
- Homologar conta, produtos, fluxos, politicas e requisitos legais com os provedores competentes.

Sem webhook, a aplicacao mantem estados pendentes e nao contabiliza o pagamento como recebido. Essa limitacao e deliberada para nao apresentar uma cobranca nao confirmada como dinheiro liquidado.