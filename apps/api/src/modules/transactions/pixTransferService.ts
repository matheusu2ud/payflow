import { isIP } from 'node:net';
import { z } from 'zod';
import { env } from '../../config/env.js';

const pixKeyTypeSchema = z.enum(['cpf', 'cnpj', 'phone', 'email', 'random']);
const documentTypeSchema = z.enum(['cpf', 'cnpj']);

const documentSchema = z.object({
  type: documentTypeSchema,
  number: z.string().trim().min(1).max(32).transform((value) => value.replace(/\D/g, '')),
}).superRefine((document, context) => {
  const expectedLength = document.type === 'cpf' ? 11 : 14;
  if (document.number.length !== expectedLength) {
    context.addIssue({
      code: 'custom',
      path: ['number'],
      message: `O documento deve conter ${expectedLength} numeros.`,
    });
  }
});

const pixKeySchema = z.object({
  type: pixKeyTypeSchema,
  key: z.string().trim().min(1).max(254),
}).transform(({ type, key }) => ({
  type,
  key: type === 'cpf' || type === 'cnpj'
    ? key.replace(/\D/g, '')
    : type === 'phone'
      ? key.replace(/[^\d+]/g, '')
      : type === 'email'
        ? key.toLowerCase()
        : key,
}));

export const pixTransferRequestSchema = z.object({
  identifier: z.string().uuid(),
  amount: z.number().finite().positive().refine(
    (amount) => Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-8,
    'O valor deve ter no maximo duas casas decimais.',
  ),
  pix: pixKeySchema,
  owner: z.object({
    name: z.string().trim().min(1).max(100)
      .transform((name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
      .refine((name) => /^[A-Za-z ]+$/.test(name), 'O nome deve conter apenas letras e espacos, sem acentos.'),
    document: documentSchema,
  }),
}).superRefine((transfer, context) => {
  if (transfer.pix.type === 'cpf' || transfer.pix.type === 'cnpj') {
    if (transfer.pix.type !== transfer.owner.document.type) {
      context.addIssue({
        code: 'custom',
        path: ['owner', 'document', 'type'],
        message: 'O tipo do documento deve corresponder ao tipo da chave Pix.',
      });
    } else if (transfer.pix.key !== transfer.owner.document.number) {
      context.addIssue({
        code: 'custom',
        path: ['pix', 'key'],
        message: 'A chave Pix e o documento do titular devem ser iguais.',
      });
    }
  }
  if (transfer.pix.type === 'email' && !z.string().email().safeParse(transfer.pix.key).success) {
    context.addIssue({ code: 'custom', path: ['pix', 'key'], message: 'Informe um e-mail valido como chave Pix.' });
  }
  if (transfer.pix.type === 'phone' && !/^\+?\d{8,15}$/.test(transfer.pix.key)) {
    context.addIssue({ code: 'custom', path: ['pix', 'key'], message: 'Informe um telefone Pix valido, incluindo o codigo do pais se necessario.' });
  }
});

export type PixTransferRequest = z.infer<typeof pixTransferRequestSchema>;

const providerTransferResponseSchema = z.object({
  withdraw: z.object({
    id: z.string().min(1),
    amount: z.number().finite().nonnegative(),
    feeAmount: z.number().finite().nonnegative(),
    currency: z.string().default('BRL'),
    status: z.enum(['PENDING', 'COMPLETED', 'CANCELED', 'PROCESSING', 'TRANSFERRING']),
    rejectedReason: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }).passthrough(),
  receiptUrl: z.string().optional(),
}).passthrough();

function providerErrorBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    return { errorCode: 'TRANSFER_PROVIDER_REJECTED', message: 'A Poseidon rejeitou a solicitacao de saque.' };
  }

  const providerBody = body as Record<string, unknown>;
  return {
    ...(typeof providerBody.statusCode === 'number' && { statusCode: providerBody.statusCode }),
    ...(typeof providerBody.errorCode === 'string' && { errorCode: providerBody.errorCode }),
    message: typeof providerBody.message === 'string'
      ? providerBody.message
      : 'A Poseidon rejeitou a solicitacao de saque.',
    ...(Array.isArray(providerBody.details) && { details: providerBody.details }),
  };
}

export async function createPixTransfer(
  transfer: PixTransferRequest,
  clientIp: string,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const publicKey = env.POSEIDON_PUBLIC_KEY;
  const secretKey = env.POSEIDON_SECRET_KEY;
  if (!publicKey || !secretKey) {
    throw new Error('Poseidon transfer credentials are not configured');
  }

  if (isIP(clientIp) !== 4) {
    return {
      statusCode: 400,
      body: {
        statusCode: 400,
        errorCode: 'TRANSFER_CLIENT_IP_UNAVAILABLE',
        message: 'Nao foi possivel identificar um endereco IPv4 valido para a transferencia. Configure o proxy confiavel da API.',
      },
    };
  }

  const response = await fetch(env.POSEIDON_TRANSFER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-public-key': publicKey,
      'x-secret-key': secretKey,
    },
    body: JSON.stringify({
      identifier: transfer.identifier,
      amount: transfer.amount,
      discountFeeOfReceiver: true,
      pix: transfer.pix,
      owner: { ...transfer.owner, ip: clientIp },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const responseText = await response.text();
  let providerBody: unknown;
  try {
    providerBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    return {
      statusCode: 502,
      body: {
        statusCode: 502,
        errorCode: 'TRANSFER_INVALID_PROVIDER_RESPONSE',
        message: 'A resposta da Poseidon nao estava em um formato valido. Consulte o painel do provedor antes de tentar novamente.',
      },
    };
  }

  if (!response.ok) {
    return { statusCode: response.status, body: providerErrorBody(providerBody) };
  }

  const parsedResponse = providerTransferResponseSchema.safeParse(providerBody);
  if (!parsedResponse.success) {
    return {
      statusCode: 502,
      body: {
        statusCode: 502,
        errorCode: 'TRANSFER_INVALID_PROVIDER_RESPONSE',
        message: 'A Poseidon retornou uma resposta de saque incompleta. Consulte o painel do provedor antes de tentar novamente.',
      },
    };
  }

  const { withdraw: providerWithdraw, receiptUrl } = parsedResponse.data;
  const withdraw = {
    id: providerWithdraw.id,
    amount: providerWithdraw.amount,
    feeAmount: providerWithdraw.feeAmount,
    currency: providerWithdraw.currency,
    status: providerWithdraw.status,
    rejectedReason: providerWithdraw.rejectedReason,
    createdAt: providerWithdraw.createdAt,
    updatedAt: providerWithdraw.updatedAt,
  };
  if (withdraw.status === 'CANCELED') {
    return {
      statusCode: 422,
      body: {
        statusCode: 422,
        errorCode: 'TRANSFER_REJECTED',
        message: withdraw.rejectedReason || 'A Poseidon cancelou o saque.',
        withdraw,
      },
    };
  }

  return {
    statusCode: response.status,
    body: {
      withdraw,
      ...(receiptUrl && { receiptUrl }),
    },
  };
}
