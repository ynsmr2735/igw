const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

export const SUPABASE_URL = url;
export const SUPABASE_KEY = key;

/** True only when both public Supabase values are provided. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && key);
}
