import { createBrowserClient } from "@supabase/ssr";

function firstConfiguredValue(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

export function createClient() {
  const url = firstConfiguredValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_CODED_SUPABASE_URL,
  );
  const key = firstConfiguredValue(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_CODED_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_CODED_SUPABASE_ANON_KEY,
  );

  if (!url || !key) {
    throw new Error("Supabase is not configured for this environment.");
  }

  return createBrowserClient(url, key);
}
