# PayFlow

Painel de pagamentos com Supabase Auth/Postgres, Row Level Security e checkout Pix no backend via Poseidon. O painel nao carrega clientes, saldos ou pagamentos ficticios. Consulte o [guia completo](docs/GUIA_COMPLETO.md) para configurar os servicos.

## Requisitos

- Node.js 20+ e npm.
- Projeto Supabase ativo.
- Conta Poseidon habilitada para receber Pix.

## Inicializacao

Na pasta do projeto, no PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item apps/web/.env.example apps/web/.env
npm install
```

Preencha os dois arquivos `.env` locais com os valores do Supabase. No `.env` da raiz, configure tambem as chaves Poseidon e `PAYFLOW_ALLOWED_EMAILS`. Nunca compartilhe `SUPABASE_SERVICE_ROLE_KEY` ou `POSEIDON_SECRET_KEY`.

No Supabase SQL Editor, execute [supabase/migrations/20261028000001_gateway_tables.sql](supabase/migrations/20261028000001_gateway_tables.sql). Depois, inicie API e web em dois terminais:

```powershell
npm run dev --workspace @payflow/api
npm run dev --workspace @payflow/web
```

Web: `http://localhost:5173` (ou a porta informada pelo Vite). API: `http://localhost:3333/health`.

## Publicacao na Netlify e Render

O frontend e a API sao servicos separados em producao. Publique a API como um servico Web no Render, usando a pasta do projeto como raiz, com os comandos:

```text
Build: npm ci && npm run build --workspace @payflow/api
Start: npm run start --workspace @payflow/api
```

Configure no Render as variaveis `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSEIDON_PUBLIC_KEY`, `POSEIDON_SECRET_KEY`, `PAYFLOW_ALLOWED_EMAILS` e `CORS_ORIGIN`. Em `CORS_ORIGIN`, informe o dominio exato publicado na Netlify (por exemplo, `https://seu-site.netlify.app`). O Render define a porta do servico automaticamente.

Na Netlify, configure `VITE_API_URL` com a URL publica do servico Render (sem `/` no final), alem de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Use o comando `npm run build --workspace @payflow/web` e publique `apps/web/dist`. Depois de alterar variaveis `VITE_*`, faca um novo deploy do frontend.

## Fluxos reais implementados

- Login e criacao de conta via Supabase Auth, com nome completo e telefone salvos nos metadados do usuario.
- Clientes, links, cobrancas e recibos persistidos no Supabase, com politicas RLS por usuario.
- Checkout Pix por link: o servidor busca o link e o valor no banco, chama o Poseidon com segredos do backend e salva a resposta.
- Criacao de cobranca Pix autenticada e restrita por allowlist de e-mail.
- Solicitacao de deposito via Pix pelo gateway; a operacao fica pendente e nao cria saldo interno.
- Aviso no fluxo de links: nao e necessario saldo previo para criar um link, mas recebimentos dependem do Pix habilitado na conta Poseidon.
- O frontend nao pode gravar status de pagamento; cobranças so aparecem como concluidas quando o provedor retorna esse status.

## Validacao

```powershell
npm run build
npm test
npm run lint
npm audit
```

## Limites de integracao

O callback/webhook de confirmacao do Poseidon ainda depende do contrato de notificacao do provedor, que nao foi fornecido. Sem ele, o dashboard nao deve presumir que um Pix pendente foi pago. Repasses bancarios, saldo bancario e emissao de NFS-e tambem exigem provedores e credenciais especificos.

A opcao “Depositar via Pix” gera uma cobranca para a conta recebedora configurada no gateway. Ela nao credita saldo no PayFlow: a confirmacao oficial do provedor e uma integracao de carteira ainda precisam ser configuradas.