import { redirect } from "next/navigation";

export default function IntegrationsPage() {
  // The current workspace-wide manager and provider directory live on Connections.
  // Keep the historical Integrations navigation route as a stable entry point.
  redirect("/dashboard/connections");
}
