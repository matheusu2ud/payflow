import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const containsPlaceholder = (value: string | undefined) => !value || /SEU_PROJETO|sua_anon_key|placeholder/i.test(value);
export const isSupabaseConfigured = Boolean(
  supabaseUrl
  && supabaseAnonKey
  && !containsPlaceholder(supabaseUrl)
  && !containsPlaceholder(supabaseAnonKey),
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export async function getSupabaseStatus(): Promise<{ connected: boolean; url: string }> {
  return {
    connected: isSupabaseConfigured,
    url: supabaseUrl ?? '',
  };
}
