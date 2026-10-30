import { z } from 'zod';
import { env } from '../../config/env.js';

const moneySchema = z.number().finite().min(0.01);
const optionalFeeSchema = z.number().finite().nonnegative().optional();

export const pixReceiveRequestSchema = z.object({
  identifier: z.string().min(1),
  amount: moneySchema,
  shippingFee: optionalFeeSchema,
  extraFee: optionalFeeSchema,
  discount: optionalFeeSchema,
  client: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1).optional(),
    document: z.string().min(1).optional(),
  }),
  products: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    quantity: z.number().int().positive().optional(),
    price: moneySchema,
    physical: z.boolean().optional(),
  })).optional(),
  splits: z.array(z.object({
    producerId: z.string().min(1),
    amount: moneySchema,
  })).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  metadata: z.record(z.string(), z.unknown()).or(z.string()).optional(),
  callbackUrl: z.string().url().optional(),
});

export type PixReceiveRequest = z.infer<typeof pixReceiveRequestSchema>;

export async function receivePix(payload: PixReceiveRequest): Promise<{ statusCode: number; body: unknown }> {
  if (!env.POSEIDON_PUBLIC_KEY || !env.POSEIDON_SECRET_KEY) {
    throw new Error('Poseidon credentials are not configured');
  }

  const response = await fetch(env.POSEIDON_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-public-key': env.POSEIDON_PUBLIC_KEY,
      'x-secret-key': env.POSEIDON_SECRET_KEY,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });

  const responseText = await response.text();
  let body: unknown;

  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    body = { message: 'O provedor retornou uma resposta inválida.' };
  }

  return { statusCode: response.status, body };
}