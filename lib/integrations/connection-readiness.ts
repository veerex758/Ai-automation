export function isWorkspaceIntegrationReady(status: unknown, lastTestStatus: unknown): boolean {
  return status === "connected" && lastTestStatus === "passed";
}
