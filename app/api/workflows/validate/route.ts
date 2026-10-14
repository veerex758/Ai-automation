import { createClient } from "@/lib/supabase/server";
import { validateWorkflowDefinition } from "@/lib/workflows/validation";
import validationApi from "@/lib/workflows/validation-api.cjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return Response.json(
      { error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return validationApi.handleWorkflowValidation(request, validateWorkflowDefinition);
}
