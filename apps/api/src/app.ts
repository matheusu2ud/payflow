import fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createClient } from '@supabase/supabase-js';
import { env } from './config/env.js';
import { createPersistedPixCharge, createPixCheckout, getPixCheckoutLink, pixCheckoutRequestSchema } from './modules/transactions/pixCheckoutService.js';
import { pixReceiveRequestSchema } from './modules/transactions/pixReceiveService.js';

function isConfigured(value: string | undefined): value is string {
  return Boolean(value && !/SEU_PROJETO|sua_|placeholder|change_me/i.test(value));
}

export async function buildApp(): Promise<FastifyInstance> {
  const supabaseAuth = isConfigured(env.SUPABASE_URL) && isConfigured(env.SUPABASE_ANON_KEY)
    ? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    : null;
  const supabaseAdmin = isConfigured(env.SUPABASE_URL) && isConfigured(env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

  const app = fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      ...(env.NODE_ENV !== 'production' && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
    },
  });

  await app.register(helmet, { global: true });
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (env.NODE_ENV === 'development') {
    allowedOrigins.push('http://localhost:5173', 'http://localhost:5174');
  }
  await app.register(cors, {
    origin: [...new Set(allowedOrigins)],
    credentials: true,
  });
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1'],
    keyGenerator: (request) => request.ip ?? 'unknown',
  });

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'payflow-api',
  }));

  app.get('/', async () => ({
    name: 'PayFlow API',
    version: '1.0.0',
    status: 'ready',
  }));

  app.post<{ Params: { linkId: string } }>('/api/v1/checkout/:linkId/pix', async (request, reply) => {
    if (!supabaseAdmin || !isConfigured(env.POSEIDON_PUBLIC_KEY) || !isConfigured(env.POSEIDON_SECRET_KEY)) {
      return reply.code(503).send({
        statusCode: 503,
        errorCode: 'CHECKOUT_NOT_CONFIGURED',
        message: 'Configure Supabase e Poseidon no ambiente da API para ativar o checkout.',
      });
    }

    const parsedRequest = pixCheckoutRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return reply.code(400).send({
        statusCode: 400,
        errorCode: 'GATEWAY_INVALID_DATA',
        message: 'Dados do cliente invalidos.',
        details: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          error: { message: issue.message },
        })),
      });
    }

    try {
      const result = await createPixCheckout(supabaseAdmin, request.params.linkId, parsedRequest.data);
      return reply.code(result.statusCode).send(result.body);
    } catch (error) {
      request.log.error({ err: error }, 'Pix checkout creation failed');
      return reply.code(502).send({
        statusCode: 502,
        errorCode: 'CHECKOUT_PROVIDER_UNAVAILABLE',
        message: 'Nao foi possivel concluir o checkout. Verifique o status antes de tentar novamente.',
      });
    }
  });

  app.get<{ Params: { linkId: string } }>('/api/v1/checkout/:linkId', async (request, reply) => {
    if (!supabaseAdmin) {
      return reply.code(503).send({
        statusCode: 503,
        errorCode: 'CHECKOUT_NOT_CONFIGURED',
        message: 'Configure o Supabase no ambiente da API para consultar links.',
      });
    }

    try {
      const result = await getPixCheckoutLink(supabaseAdmin, request.params.linkId);
      return reply.code(result.statusCode).send(result.body);
    } catch (error) {
      request.log.error({ err: error }, 'Payment link lookup failed');
      return reply.code(502).send({
        statusCode: 502,
        errorCode: 'CHECKOUT_UNAVAILABLE',
        message: 'Nao foi possivel consultar este link de pagamento.',
      });
    }
  });

  app.post('/api/v1/gateway/pix/receive', async (request, reply) => {
    if (!supabaseAuth || !supabaseAdmin) {
      return reply.code(503).send({
        statusCode: 503,
        errorCode: 'GATEWAY_DATABASE_NOT_CONFIGURED',
        message: 'Configure Supabase Auth e a service role da API antes de criar cobrancas.',
      });
    }

    const bearerToken = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearerToken) {
      return reply.code(401).send({
        statusCode: 401,
        errorCode: 'GATEWAY_UNAUTHORIZED',
        message: 'Uma sessao Supabase valida e obrigatoria.',
      });
    }

    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(bearerToken);
    if (authError || !authData.user?.email) {
      return reply.code(401).send({
        statusCode: 401,
        errorCode: 'GATEWAY_UNAUTHORIZED',
        message: 'A sessao Supabase e invalida ou expirou.',
      });
    }

    const allowedEmails = env.PAYFLOW_ALLOWED_EMAILS.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!allowedEmails.includes(authData.user.email.toLowerCase())) {
      return reply.code(403).send({
        statusCode: 403,
        errorCode: 'GATEWAY_FORBIDDEN',
        message: 'Esta conta nao esta autorizada para criar cobrancas.',
      });
    }

    const parsedRequest = pixReceiveRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return reply.code(400).send({
        statusCode: 400,
        errorCode: 'GATEWAY_INVALID_DATA',
        message: 'Dados da requisição inválidos, verifique details para mais informações.',
        details: parsedRequest.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          error: { message: issue.message },
        })),
      });
    }

    if (!isConfigured(env.POSEIDON_PUBLIC_KEY) || !isConfigured(env.POSEIDON_SECRET_KEY)) {
      return reply.code(503).send({
        statusCode: 503,
        errorCode: 'GATEWAY_PROVIDER_NOT_CONFIGURED',
        message: 'Configure as credenciais Poseidon no ambiente da API.',
      });
    }

    try {
      const result = await createPersistedPixCharge(supabaseAdmin, authData.user.id, parsedRequest.data);
      return reply.code(result.statusCode).send(result.body);
    } catch (error) {
      request.log.error({ err: error }, 'Authenticated Pix charge failed');
      return reply.code(502).send({
        statusCode: 502,
        errorCode: 'GATEWAY_PROVIDER_UNAVAILABLE',
        message: 'Não foi possível concluir a solicitação Pix no provedor.',
      });
    }
  });

  return app;
}
