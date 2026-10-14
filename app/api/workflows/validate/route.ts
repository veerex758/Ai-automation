import { validateWorkflowDefinition } from "@/lib/workflows/validation";
import validationApi from "@/lib/workflows/validation-api.cjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return validationApi.handleWorkflowValidation(request, validateWorkflowDefinition);
}
