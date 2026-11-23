import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliverWorkspaceOperationalAlerts, type OperationalAlert } from "@/lib/operations/alert-delivery";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== "Bearer " + secret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createAdminClient();
  const { data: workspaces, error } = await admin.from("workspaces").select("id").limit(1000);
  if (error) return NextResponse.json({ error: "Could not load workspaces." }, { status: 503 });
  const results: Array<{ workspace_id: string; attempted: number; sent: number; failed: number }> = [];
  for (const workspace of workspaces ?? []) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [queued, retry, waiting, dead, failedRuns, integrations, workers] = await Promise.all([
      admin.from("execution_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "queued"),
      admin.from("execution_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "retry_wait"),
      admin.from("execution_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "waiting"),
      admin.from("execution_jobs").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "dead_letter"),
      admin.from("workflow_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "failed").gte("created_at", since),
      admin.from("workspace_integrations").select("provider").eq("workspace_id", workspace.id).eq("last_test_status", "failed"),
      admin.from("execution_worker_heartbeats").select("worker_id,last_seen_at").order("last_seen_at", { ascending: false }).limit(20),
    ]);
    if ([queued.error, retry.error, waiting.error, dead.error, failedRuns.error, integrations.error, workers.error].some(Boolean)) continue;
    const alerts: OperationalAlert[] = [];
    if ((queued.count ?? 0) + (retry.count ?? 0) + (waiting.count ?? 0) >= 25) alerts.push({ key: "queue_backlog", title: "Execution queue backlog", message: "Queued, retrying and waiting jobs have reached at least 25.", severity: "warning" });
    if ((dead.count ?? 0) > 0) alerts.push({ key: "dead_letter", title: "Dead-letter jobs require attention", message: (dead.count ?? 0) + " execution jobs are in the dead-letter queue.", severity: "critical" });
    if ((failedRuns.count ?? 0) >= 5) alerts.push({ key: "workflow_failures", title: "Workflow failure threshold reached", message: (failedRuns.count ?? 0) + " workflow runs failed in the last 24 hours.", severity: "warning" });
    if ((workers.data ?? []).some((worker) => Date.now() - Date.parse(worker.last_seen_at) >= 10 * 60 * 1000)) alerts.push({ key: "worker_offline", title: "Worker heartbeat missing", message: "At least one worker has not reported a heartbeat in ten minutes.", severity: "critical" });
    if ((integrations.data ?? []).length) alerts.push({ key: "provider_failure", title: "Provider connection failure", message: (integrations.data ?? []).map((item) => item.provider).join(", ") + " failed the latest connection test.", severity: "warning" });
    if (alerts.length) {
      try {
        const result = await deliverWorkspaceOperationalAlerts(workspace.id, alerts);
        results.push({ workspace_id: workspace.id, ...result });
      } catch (deliveryError) {
        console.error("Operational alert delivery failed:", workspace.id, deliveryError);
        results.push({ workspace_id: workspace.id, attempted: 0, sent: 0, failed: alerts.length });
      }
    }
  }
  return NextResponse.json({ processed_workspaces: workspaces?.length ?? 0, results });
}
