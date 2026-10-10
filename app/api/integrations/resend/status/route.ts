import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isResendConfigured, getAllowedRecipients, isLiveEmailRecipientAllowed } from "@/lib/integrations/resend.cjs";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const configured = isResendConfigured();
    const recipientAllowlistConfigured = getAllowedRecipients().length > 0;
    const liveExecutionEnabled = process.env.AIVANTA_LIVE_EXECUTION_ENABLED === "true";
    return NextResponse.json({
      provider: "resend",
      configured,
      recipientAllowlistConfigured,
      liveExecutionEnabled,
      ready: configured && recipientAllowlistConfigured && liveExecutionEnabled,
      missing: [
        ...(!process.env.RESEND_API_KEY?.trim() ? ["RESEND_API_KEY"] : []),
        ...(!process.env.RESEND_FROM_EMAIL?.trim() ? ["RESEND_FROM_EMAIL"] : []),
        ...(!recipientAllowlistConfigured ? ["AIVANTA_LIVE_EMAIL_RECIPIENTS"] : []),
        ...(!liveExecutionEnabled ? ["AIVANTA_LIVE_EXECUTION_ENABLED"] : []),
      ],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to check Aivanta email integration readiness:", error);
    return NextResponse.json({ error: "Could not check email integration status." }, { status: 500 });
  }
}
