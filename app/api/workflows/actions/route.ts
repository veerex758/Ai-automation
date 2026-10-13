import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActionCatalog } from "@/lib/workflows/action-catalog.cjs";

export const dynamic = "force-dynamic";

function actionCatalogJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return actionCatalogJson({ error: "Authentication required." }, { status: 401 });
    }

    return actionCatalogJson({
      actions: getActionCatalog(),
      executionPolicy: {
        defaultMode: "dry_run",
        liveExecutionEnabledByDefault: false,
        note: "Catalog entries describe available workflow action types, not a guarantee that external services are connected.",
      },
    });
  } catch (error) {
    console.error("Failed to load Aivanta action catalog:", error);
    return actionCatalogJson({ error: "Could not load workflow actions. Please try again." }, { status: 500 });
  }
}
