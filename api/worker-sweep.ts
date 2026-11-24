import type { IncomingMessage, ServerResponse } from "node:http";
import { runDurableWorker } from "../lib/workflows/durable-worker";

/**
 * Private Vercel Schedule function. The schedule/v1beta trigger prevents
 * public invocation; the environment flag keeps Preview/Production sweeps off
 * until that environment has passed the scheduler acceptance gate.
 */
export default async function workerSweep(_request: IncomingMessage, response: ServerResponse) {
  if (process.env.AIVANTA_DURABLE_WORKER_SCHEDULE_ENABLED !== "true") {
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    const result = await runDurableWorker();
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(result));
  } catch {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ error: "DURABLE_WORKER_SWEEP_FAILED" }));
  }
}
