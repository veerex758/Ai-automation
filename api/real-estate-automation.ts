import { handleSchedule } from "@vercel/schedules";
import { createRealEstateServiceClient } from "../lib/real-estate/server";
import { processRealEstateLeadPipeline } from "../lib/real-estate/pipeline";
import { processDueRealEstateFollowups } from "../lib/real-estate/followups";

/**
 * Private Vercel Schedule. Preview deployments deliberately do no work because
 * their Supabase URL currently points at the same database as Production.
 * Live provider calls stay disabled until server flags, tested credentials,
 * operation approvals and an agency notification recipient are all configured.
 */
export const POST = handleSchedule(async (metadata) => {
  if (process.env.VERCEL_ENV !== "production") {
    console.info("Real-estate schedule skipped outside Production", {
      schedule: metadata.name,
      executionId: metadata.executionId,
      environment: process.env.VERCEL_ENV ?? "unknown",
    });
    return;
  }

  const liveExecution = process.env.AIVANTA_LIVE_EXECUTION_ENABLED === "true";
  const pipelineEnabled = process.env.REAL_ESTATE_PIPELINE_ENABLED === "true";
  const followupsEnabled = process.env.REAL_ESTATE_FOLLOWUPS_ENABLED === "true";
  if (!liveExecution || (!pipelineEnabled && !followupsEnabled)) {
    console.info("Real-estate schedule is disabled by server feature controls", {
      schedule: metadata.name,
      executionId: metadata.executionId,
    });
    return;
  }

  const db = createRealEstateServiceClient();
  const pipeline = pipelineEnabled
    ? await processRealEstateLeadPipeline({ db, limit: 20 })
    : { enabled: false, claimed: 0, completed: 0, blocked: 0, failed: 0 };
  const followups = followupsEnabled
    ? await processDueRealEstateFollowups(db)
    : { enabled: false, claimed: 0, sent: 0, retried: 0, failed: 0, blocked: 0, cancelled: 0 };

  console.info("Real-estate scheduled automation completed", {
    schedule: metadata.name,
    executionId: metadata.executionId,
    scheduledAt: metadata.scheduledAt.toISOString(),
    pipeline,
    followups,
  });
});
