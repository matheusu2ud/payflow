import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

for (const envPath of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  POSEIDON_API_URL: z.string().url().default('https://app.poseidonpay.site/api/v1/gateway/pix/receive'),
  POSEIDON_PUBLIC_KEY: z.string().min(1).optional(),
  POSEIDON_SECRET_KEY: z.string().min(1).optional(),
  PAYFLOW_ALLOWED_EMAILS: z.string().default(''),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export const env = envSchema.parse(process.env);
