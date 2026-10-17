"use strict";

/**
 * Execute a Supabase RPC without allowing transport exceptions to escape.
 * The caller receives a stable error marker and must never log the raw error.
 */
async function callSchedulerRpc(rpc, name, args) {
  try {
    const response = await rpc(name, args);
    if (!response || typeof response !== "object") {
      return { data: null, error: new Error("SCHEDULER_RPC_INVALID_RESPONSE") };
    }
    return { data: response.data ?? null, error: response.error ?? null };
  } catch {
    return { data: null, error: new Error("SCHEDULER_RPC_TRANSPORT_FAILED") };
  }
}

module.exports = { callSchedulerRpc };
