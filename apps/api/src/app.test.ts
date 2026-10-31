import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubEnv('JWT_SECRET', 'payflow_test_jwt_secret_for_automated_tests_only');
vi.stubEnv('JWT_REFRESH_SECRET', 'payflow_test_refresh_secret_for_automated_tests_only');
vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/payflow_test');
vi.stubEnv('SUPABASE_URL', 'https://payflow-test.supabase.co');
vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon-key');
vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
vi.stubEnv('POSEIDON_PUBLIC_KEY', 'provider-public-test');
vi.stubEnv('POSEIDON_SECRET_KEY', 'provider-secret-test');
vi.stubEnv('PAYFLOW_ALLOWED_EMAILS', 'owner@example.com');

const { buildApp } = await import('./app.js');

const endpoint = '/api/v1/gateway/pix/receive';
const headers = {
  authorization: 'Bearer test-access-token',
};
const validPayload = {
  identifier: 'order-test-001',
  amount: 100.5,
  client: {
    name: 'Joao da Silva',
    email: 'joao@example.com',
    phone: '11999999999',
  },
};

describe('POST /api/v1/gateway/pix/receive', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app;
  });

  afterAll(async () => {
    await (await app).close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockSuccessfulRequests(providerBody?: Record<string, unknown>) {
    const body = providerBody ?? {
      transactionId: 'provider-tx-1',
      status: 'OK',
      transactionStatus: 'PENDING',
      fee: 5,
      order: { id: 'provider-order-1' },
      pix: { code: ' \npix-copy-code \r\n' },
    };
    const fetchMock = vi.fn().mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'd1f6c7f0-8266-4f69-a9a8-39a0e44a31fc',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'owner@example.com',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          created_at: '2026-10-28T00:00:00.000Z',
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url.includes('/rest/v1/customers')) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes('/rest/v1/charges') && init?.method === 'POST') return Promise.resolve(new Response(null, { status: 201 }));
      if (url.includes('/rest/v1/charges') && init?.method === 'PATCH') return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes('poseidonpay.site')) return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('rejects requests without a Supabase session', async () => {
    const response = await (await app).inject({ method: 'POST', url: endpoint, payload: validPayload });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ errorCode: 'GATEWAY_UNAUTHORIZED' });
  });

  it('returns structured validation errors without creating a provider charge', async () => {
    const fetchMock = mockSuccessfulRequests();
    const response = await (await app).inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: { ...validPayload, amount: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      errorCode: 'GATEWAY_INVALID_DATA',
      details: [{ path: 'amount' }],
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('poseidonpay.site'))).toBe(false);
  });

  it('uses server credentials, persists the charge, and returns the provider status', async () => {
    const fetchMock = mockSuccessfulRequests();
    const response = await (await app).inject({ method: 'POST', url: endpoint, headers, payload: validPayload });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ transactionId: 'provider-tx-1', status: 'PENDING', pix: { code: 'pix-copy-code' } });
    const providerCall = fetchMock.mock.calls.find(([url]) => String(url).includes('poseidonpay.site'));
    expect(providerCall?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ 'x-public-key': 'provider-public-test', 'x-secret-key': 'provider-secret-test' }),
      body: JSON.stringify(validPayload),
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/rest/v1/charges'))).toBe(true);
    const chargeUpdate = fetchMock.mock.calls
      .filter(([url, init]) => String(url).includes('/rest/v1/charges') && init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
      .find((body) => body.pix_copy_paste);
    expect(chargeUpdate?.pix_copy_paste).toBe('pix-copy-code');
  });

  it('does not return a Pix code when the provider marks the transaction as failed', async () => {
    const fetchMock = mockSuccessfulRequests({
      transactionId: 'provider-tx-failed',
      status: 'FAILED',
      transactionStatus: 'PENDING',
      errorDescription: 'Transaction denied by anti-fraud',
      fee: 5,
      order: { id: 'provider-order-failed' },
      pix: { code: 'unpayable-pix-code' },
    });

    const response = await (await app).inject({
      method: 'POST',
      url: endpoint,
      headers,
      payload: validPayload,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errorCode: 'PIX_CHARGE_NOT_PAYABLE',
      message: 'Transaction denied by anti-fraud',
    });
    expect(response.json()).not.toHaveProperty('pix');

    const failedChargeUpdate = fetchMock.mock.calls
      .filter(([url, init]) => String(url).includes('/rest/v1/charges') && init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
      .find((body) => body.status === 'FAILED');
    expect(failedChargeUpdate).toMatchObject({
      provider_transaction_id: 'provider-tx-failed',
      status: 'FAILED',
    });
    expect(failedChargeUpdate).not.toHaveProperty('pix_copy_paste');
  });

  it('uses the active Supabase link amount for public checkout', async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rest/v1/payment_links')) {
        return Promise.resolve(new Response(JSON.stringify([{
          id: 'ln_real_1',
          user_id: 'd1f6c7f0-8266-4f69-a9a8-39a0e44a31fc',
          name: 'Plano Real',
          amount_cents: 12900,
          status: 'ACTIVE',
        }]), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url.includes('/rest/v1/customers')) return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes('/rest/v1/charges') && init?.method === 'POST') return Promise.resolve(new Response(null, { status: 201 }));
      if (url.includes('/rest/v1/charges') && init?.method === 'PATCH') return Promise.resolve(new Response(null, { status: 204 }));
      if (url.includes('poseidonpay.site')) return Promise.resolve(new Response(JSON.stringify({
        transactionId: 'provider-checkout-tx',
        status: 'OK',
        transactionStatus: 'PENDING',
        fee: 3,
        order: { id: 'provider-order' },
        pix: { code: 'real-pix-code' },
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await (await app).inject({
      method: 'POST',
      url: '/api/v1/checkout/ln_real_1/pix',
      payload: {
        identifier: '7c1a2502-bd45-4a56-a8b8-2e5a90794001',
        client: { name: 'Cliente Real', email: 'cliente@example.com' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ transactionId: 'provider-checkout-tx', status: 'PENDING' });
    const providerCall = fetchMock.mock.calls.find(([url]) => String(url).includes('poseidonpay.site'));
    expect(JSON.parse(String(providerCall?.[1]?.body))).toMatchObject({ amount: 129, products: [{ name: 'Plano Real', price: 129 }] });
  });
});