import "server-only";
import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { buildFollowupSchedule } from "@/lib/real-estate/lead-scoring";

export function createRealEstateServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.CODED_SUPABASE_URL || process.env.NEXT_PUBLIC_CODED_SUPABASE_URL;
  // Empty Vercel placeholders must not mask the integration-provided server key.
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.CODED_SUPABASE_SERVICE_ROLE_KEY || process.env.CODED_SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("REAL_ESTATE_SERVICE_DATABASE_NOT_CONFIGURED");
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export function hashPublicIntakeKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createFollowupRows(lead: {
  id: string; workspace_id: string; full_name: string; email: string | null;
  preferred_location: string | null; property_type: string; transaction_type: string;
}, createdAt: Date) {
  const firstName = lead.full_name.trim().split(/\s+/)[0] || "there";
  const property = lead.property_type !== "unknown" ? lead.property_type : "property";
  const location = lead.preferred_location ? " in " + lead.preferred_location : "";
  const action = lead.transaction_type === "rent" ? "rent" : lead.transaction_type === "sell" ? "sell" : "buy";
  const messages = [
    { subject: "We received your property enquiry", message: "Hi " + firstName + ", thanks for contacting us about your " + property + location + ". Our team has received your enquiry and will review your requirements. Reply to this email with any extra details that would help us assist you." },
    { subject: "A quick follow-up on your property enquiry", message: "Hi " + firstName + ", I am following up on your " + action + " enquiry" + location + ". Are you still looking, and is there anything you would like us to clarify about the next steps?" },
    { subject: "More options for your property search", message: "Hi " + firstName + ", we would be glad to narrow down suitable " + property + " options" + location + ". Has your budget, preferred area or timeline changed since your enquiry?" },
    { subject: "A monthly check-in on your property plans", message: "Hi " + firstName + ", checking in on your property plans" + location + ". We can refresh your matches or arrange a conversation with an agent if your requirements have changed." },
    { subject: "Your property search — 90-day check-in", message: "Hi " + firstName + ", this is our scheduled 90-day check-in about your property enquiry" + location + ". Would you like us to keep helping, update your requirements, or close the enquiry? Reply at any time to let us know." },
  ];
  return buildFollowupSchedule(createdAt).map((schedule, index) => ({
    workspace_id: lead.workspace_id,
    lead_id: lead.id,
    sequence: schedule.sequence,
    channel: "email",
    due_at: schedule.dueAt,
    status: "pending",
    subject: messages[index].subject,
    message: messages[index].message,
    attempt_count: 0,
    max_attempts: 3,
  }));
}
