import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL
    ?? process.env.NEXT_PUBLIC_CODED_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_CODED_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_CODED_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase is not configured for this environment.");
  }

  return createBrowserClient(url, key);
}
