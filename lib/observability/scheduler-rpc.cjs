"use strict";

/** Contain Supabase RPC transport exceptions behind stable, non-sensitive error markers. */
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
