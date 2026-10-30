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

## Fluxos reais implementados

- Login e criacao de conta via Supabase Auth.
- Clientes, links, cobrancas e recibos persistidos no Supabase, com politicas RLS por usuario.
- Checkout Pix por link: o servidor busca o link e o valor no banco, chama o Poseidon com segredos do backend e salva a resposta.
- Criacao de cobranca Pix autenticada e restrita por allowlist de e-mail.
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