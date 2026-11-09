import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Create a server-only Supabase client with the service-role key.
 *
 * Preview uses the Aivanta staging variables; Production can continue using
 * the existing CODED_* environment names until its configuration is migrated.
 */
export function createAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL
    ?? process.env.CODED_SUPABASE_URL
    ?? process.env.NEXT_PUBLIC_CODED_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.CODED_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase admin client is not configured.");
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
