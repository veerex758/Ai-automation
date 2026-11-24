import { handleSchedule } from "@vercel/schedules";
import { runDurableWorker } from "../lib/workflows/durable-worker";

/**
 * Private Vercel Schedule function. schedule/v1beta keeps this function
 * unreachable by public HTTP requests; the environment flag prevents sweeps
 * until that environment has passed the scheduler acceptance gate.
 */
export const POST = handleSchedule(async (metadata) => {
  if (process.env.AIVANTA_DURABLE_WORKER_SCHEDULE_ENABLED !== "true") return;

  const result = await runDurableWorker();
  console.info("Rexnora durable worker sweep", {
    scheduleName: metadata.name,
    scheduledAt: metadata.scheduledAt.toISOString(),
    ...result,
  });
});
