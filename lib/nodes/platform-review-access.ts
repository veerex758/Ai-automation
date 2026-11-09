import "server-only";

import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Platform trust is deliberately separate from workspace roles.
 * An unset or malformed allowlist grants nobody platform-review authority.
 */
export async function resolvePlatformNodeReviewer() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false as const, status: 401 as const, error: "Authentication required." };
  }

  const configuredIds = (process.env.AIVANTA_PLATFORM_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => UUID.test(value));

  if (configuredIds.length === 0 || !configuredIds.includes(user.id)) {
    return { ok: false as const, status: 403 as const, error: "Platform reviewer access is not configured for this account." };
  }

  return { ok: true as const, user: { id: user.id } };
}
