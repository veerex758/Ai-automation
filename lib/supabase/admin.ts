import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Create a server-only Supabase client with the service-role key.
 *
 * Preview uses the Rexnora staging variables; Production can continue using
 * the existing CODED_* environment names until its configuration is migrated.
 */
export function getAdminSupabaseConfig() {
  const isPreview = process.env.VERCEL_ENV === "preview";
  const isRexnoraStagingPreview = isPreview
    && process.env.VERCEL_GIT_COMMIT_REF === "integration/saas-core-stage3-realestate-20261123";
  const url = isPreview
    ? process.env.NEXT_PUBLIC_SUPABASE_URL
    : process.env.NEXT_PUBLIC_SUPABASE_URL
      || process.env.CODED_SUPABASE_URL
      || process.env.NEXT_PUBLIC_CODED_SUPABASE_URL;
  const serviceRoleKey = isRexnoraStagingPreview
    ? process.env.CODED_SUPABASE_SERVICE_ROLE_KEY || process.env.CODED_SUPABASE_SECRET_KEY
    : isPreview
      ? process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
      : process.env.SUPABASE_SECRET_KEY
        || process.env.SUPABASE_SERVICE_ROLE_KEY
        || process.env.CODED_SUPABASE_SERVICE_ROLE_KEY
        || process.env.CODED_SUPABASE_SECRET_KEY;
  if (!url || !serviceRoleKey) throw new Error("Supabase admin client is not configured.");
  return { url, serviceRoleKey };
}

export function createAdminClient() {
  const { url, serviceRoleKey } = getAdminSupabaseConfig();
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
