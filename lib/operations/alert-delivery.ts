import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWorkspaceCredentials } from "@/lib/integrations/workspace-credentials";

type AlertDestination = { id: string; channel: "email" | "slack"; destination: string; encrypted_secret: string | null };
export type OperationalAlert = { key: string; title: string; message: string; severity: "warning" | "critical" };

export async function deliverWorkspaceOperationalAlerts(workspaceId: string, alerts: OperationalAlert[]) {
  if (!alerts.length) return { attempted: 0, sent: 0, failed: 0 };
  const admin = createAdminClient();
  const [{ data: preferences, error: prefError }, { data: destinations, error: destinationError }] = await Promise.all([
    admin.from("workspace_alert_preferences").select("enabled,events,minimum_severity").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("workspace_alert_destinations").select("id,channel,destination,encrypted_secret").eq("workspace_id", workspaceId).eq("enabled", true),
  ]);
  if (prefError) throw prefError;
  if (destinationError) throw destinationError;
  if (preferences?.enabled === false) return { attempted: 0, sent: 0, failed: 0 };
  const enabledEvents = new Set<string>(preferences?.events ?? ["queue_backlog", "dead_letter", "worker_offline", "workflow_failures", "provider_failure"]);
  const selected = alerts.filter((alert) => enabledEvents.has(alert.key) && (preferences?.minimum_severity !== "critical" || alert.severity === "critical"));
  const targets = (destinations ?? []) as AlertDestination[];
  let attempted = 0, sent = 0, failed = 0;
  for (const alert of selected) {
    for (const destination of targets) {
      attempted++;
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: recent, error: recentError } = await admin.from("workspace_alert_deliveries")
        .select("id").eq("workspace_id", workspaceId).eq("destination_id", destination.id)
        .eq("event_key", alert.key).eq("status", "sent").gte("created_at", since).limit(1);
      if (recentError) throw recentError;
      if (recent?.length) {
        await admin.from("workspace_alert_deliveries").insert({ workspace_id: workspaceId, destination_id: destination.id, event_key: alert.key, channel: destination.channel, status: "skipped", error_code: "DEDUPLICATED_15M" });
        continue;
      }
      try {
        if (destination.channel === "slack") {
          if (!destination.encrypted_secret) throw new Error("SLACK_SECRET_MISSING");
          const credentials = decryptWorkspaceCredentials(destination.encrypted_secret, undefined, workspaceId + ":alert-slack:" + destination.id);
          const webhookUrl = credentials.slack?.webhookUrl;
          if (!webhookUrl || !/^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/.test(webhookUrl)) throw new Error("SLACK_WEBHOOK_INVALID");
          const response = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "[Aivanta " + alert.severity.toUpperCase() + "] " + alert.title + "\n" + alert.message }), signal: AbortSignal.timeout(10000), cache: "no-store", redirect: "error" });
          if (!response.ok) throw new Error("SLACK_HTTP_" + response.status);
        } else {
          const apiKey = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM_EMAIL;
          if (!apiKey || !from) throw new Error("RESEND_NOT_CONFIGURED");
          const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [destination.destination], subject: "[Aivanta " + alert.severity + "] " + alert.title, text: alert.message + "\n\nWorkspace: " + workspaceId + "\nAlert: " + alert.key }), signal: AbortSignal.timeout(10000), cache: "no-store", redirect: "error" });
          if (!response.ok) throw new Error("RESEND_HTTP_" + response.status);
        }
        await admin.from("workspace_alert_deliveries").insert({ workspace_id: workspaceId, destination_id: destination.id, event_key: alert.key, channel: destination.channel, status: "sent" });
        sent++;
      } catch (error) {
        const code = error instanceof Error ? error.message.slice(0, 80).replace(/[^A-Z0-9_:-]/gi, "_") : "DELIVERY_FAILED";
        await admin.from("workspace_alert_deliveries").insert({ workspace_id: workspaceId, destination_id: destination.id, event_key: alert.key, channel: destination.channel, status: "failed", error_code: code });
        failed++;
      }
    }
  }
  return { attempted, sent, failed };
}
