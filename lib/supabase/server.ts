import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function firstConfiguredValue(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

export async function createClient() {
  const cookieStore = await cookies();
  const url = firstConfiguredValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_CODED_SUPABASE_URL,
    process.env.CODED_SUPABASE_URL,
  );
  const key = firstConfiguredValue(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_CODED_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_CODED_SUPABASE_ANON_KEY,
    process.env.CODED_SUPABASE_PUBLISHABLE_KEY,
    process.env.CODED_SUPABASE_ANON_KEY,
  );

  if (!url || !key) {
    throw new Error("Supabase is not configured for this environment.");
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Middleware refreshes sessions.
        }
      },
    },
  });
}
