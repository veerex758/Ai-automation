import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isResendConfigured, getAllowedRecipients } from "@/lib/integrations/resend.cjs";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const configured = isResendConfigured();
    const liveExecutionEnabled = process.env.AIVANTA_LIVE_EXECUTION_ENABLED === "true";
    return NextResponse.json({
      provider: "resend",
      configured,
      liveExecutionEnabled,
      ready: configured && liveExecutionEnabled,
      missing: [
        ...(!process.env.RESEND_API_KEY?.trim() ? ["RESEND_API_KEY"] : []),
        ...(!process.env.RESEND_FROM_EMAIL?.trim() ? ["RESEND_FROM_EMAIL"] : []),
        ...(!liveExecutionEnabled ? ["AIVANTA_LIVE_EXECUTION_ENABLED"] : []),
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to check Aivanta email integration readiness:", error);
    return NextResponse.json({ error: "Could not check email integration status." }, { status: 500 });
  }
}
