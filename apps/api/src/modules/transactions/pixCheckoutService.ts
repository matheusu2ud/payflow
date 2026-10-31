import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { receivePix, type PixReceiveRequest } from './pixReceiveService.js';

export const pixCheckoutRequestSchema = z.object({
  identifier: z.string().uuid(),
  client: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(160),
    phone: z.string().trim().min(1).max(30).optional(),
    document: z.string().trim().min(1).max(32).optional(),
  }),
});

export type PixCheckoutRequest = z.infer<typeof pixCheckoutRequestSchema>;

export async function getPixCheckoutLink(
  supabaseAdmin: SupabaseClient,
  linkId: string,
): Promise<{ statusCode: number; body: unknown }> {
  const { data: link, error } = await supabaseAdmin
    .from('payment_links')
    .select('id, name, amount_cents, status')
    .eq('id', linkId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to load payment link');
  }
  if (!link || link.status !== 'ACTIVE') {
    return {
      statusCode: 404,
      body: { statusCode: 404, errorCode: 'PAYMENT_LINK_NOT_FOUND', message: 'Link de pagamento inexistente ou inativo.' },
    };
  }

  return {
    statusCode: 200,
    body: { id: link.id, name: link.name, amount: Number(link.amount_cents) / 100 },
  };
}

const providerResponseSchema = z.object({
  transactionId: z.string().min(1),
  status: z.enum(['OK', 'FAILED', 'PENDING', 'REJECTED', 'CANCELED']),
  transactionStatus: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CHARGED_BACK', 'EXPIRED']).optional(),
  errorDescription: z.string().nullable().optional(),
  fee: z.number().finite().nonnegative(),
  order: z.object({ id: z.string().min(1), url: z.string().url().optional() }).passthrough(),
  pix: z.object({ code: z.string().min(1), image: z.string().url().optional(), expiresAt: z.string().optional() }).passthrough(),
}).passthrough();

function persistedStatus(status: string) {
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'REFUNDED' || status === 'CHARGED_BACK' || status === 'EXPIRED') {
    return status;
  }
  if (status === 'REJECTED' || status === 'CANCELED') {
    return 'FAILED';
  }
  return 'PENDING';
}

export async function createPersistedPixCharge(
  supabaseAdmin: SupabaseClient,
  userId: string,
  request: PixReceiveRequest,
  paymentLinkId: string | null = null,
): Promise<{ statusCode: number; body: unknown }> {
  const customerEmail = request.client.email.toLowerCase();
  const { error: customerError } = await supabaseAdmin
    .from('customers')
    .upsert({
      user_id: userId,
      name: request.client.name,
      email: customerEmail,
      phone: request.client.phone ?? '',
    }, { onConflict: 'user_id,email' });

  if (customerError) {
    throw new Error('Unable to save checkout customer');
  }

  const chargeId = randomUUID();
  const { error: chargeError } = await supabaseAdmin
    .from('charges')
    .insert({
      id: chargeId,
      user_id: userId,
      payment_link_id: paymentLinkId,
      identifier: request.identifier,
      customer_name: request.client.name,
      customer_email: customerEmail,
      amount_cents: Math.round(request.amount * 100),
      payment_method: 'PIX',
      status: 'PENDING',
    });

  if (chargeError) {
    if (chargeError.code === '23505') {
      return {
        statusCode: 409,
        body: { statusCode: 409, errorCode: 'DUPLICATE_IDENTIFIER', message: 'Este identificador ja foi utilizado.' },
      };
    }
    throw new Error('Unable to create pending checkout charge');
  }

  const providerResult = await receivePix(request);
  if (providerResult.statusCode < 200 || providerResult.statusCode >= 300) {
    await supabaseAdmin.from('charges').update({ status: 'FAILED' }).eq('id', chargeId);
    return providerResult;
  }

  const parsedProviderResponse = providerResponseSchema.safeParse(providerResult.body);
  if (!parsedProviderResponse.success) {
    await supabaseAdmin.from('charges').update({ status: 'FAILED' }).eq('id', chargeId);
    return {
      statusCode: 502,
      body: { statusCode: 502, errorCode: 'INVALID_PROVIDER_RESPONSE', message: 'O provedor retornou dados Pix incompletos.' },
    };
  }

  const provider = parsedProviderResponse.data;
  const status = persistedStatus(provider.transactionStatus ?? provider.status);
  if (status !== 'PENDING') {
    const { error: updateError } = await supabaseAdmin
      .from('charges')
      .update({
        provider_transaction_id: provider.transactionId,
        fee_cents: Math.round(provider.fee * 100),
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', chargeId);

    if (updateError) {
      throw new Error('Unable to save rejected provider Pix response');
    }

    return {
      statusCode: 422,
      body: {
        statusCode: 422,
        errorCode: 'PIX_CHARGE_NOT_PAYABLE',
        message: provider.errorDescription?.trim()
          || `O provedor retornou o status ${status}; esta cobranca nao possui um Pix disponivel para pagamento.`,
      },
    };
  }

  const { error: updateError } = await supabaseAdmin
    .from('charges')
    .update({
      provider_transaction_id: provider.transactionId,
      fee_cents: Math.round(provider.fee * 100),
      status,
      pix_copy_paste: provider.pix.code,
      pix_image_url: provider.pix.image ?? null,
      pix_expires_at: provider.pix.expiresAt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', chargeId);

  if (updateError) {
    throw new Error('Unable to save provider Pix response');
  }

  return {
    statusCode: providerResult.statusCode,
    body: {
      ...provider,
      chargeId,
      status,
    },
  };
}

export async function createPixCheckout(
  supabaseAdmin: SupabaseClient,
  linkId: string,
  request: PixCheckoutRequest,
): Promise<{ statusCode: number; body: unknown }> {
  const { data: link, error: linkError } = await supabaseAdmin
    .from('payment_links')
    .select('id, user_id, name, amount_cents, status')
    .eq('id', linkId)
    .maybeSingle();

  if (linkError) {
    throw new Error('Unable to load payment link');
  }
  if (!link || link.status !== 'ACTIVE') {
    return {
      statusCode: 404,
      body: { statusCode: 404, errorCode: 'PAYMENT_LINK_NOT_FOUND', message: 'Link de pagamento inexistente ou inativo.' },
    };
  }

  const amount = link.amount_cents / 100;
  return createPersistedPixCharge(supabaseAdmin, link.user_id, {
    identifier: request.identifier,
    amount,
    client: request.client,
    products: [{ id: link.id, name: link.name, quantity: 1, price: amount }],
  }, link.id);
}