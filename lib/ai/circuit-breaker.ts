import type { AIProviderId } from "./types";

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitPolicy = {
  failureThreshold: number;
  failureRateThreshold: number;
  minimumRequests: number;
  windowSeconds: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
  authCooldownMs: number;
};

export const DEFAULT_CIRCUIT_POLICY: CircuitPolicy = {
  failureThreshold: 3,
  failureRateThreshold: 0.5,
  minimumRequests: 5,
  windowSeconds: 300,
  baseCooldownMs: 30_000,
  maxCooldownMs: 300_000,
  authCooldownMs: 300_000,
};

export type CircuitAdmission = {
  provider: AIProviderId;
  allowed: boolean;
  state: CircuitState;
  probe: boolean;
  retryAfterMs: number;
  consecutiveFailures: number;
  recentAttempts: number;
  recentFailures: number;
  recentFailureRate: number;
};

export type CircuitSnapshot = Omit<CircuitAdmission, "allowed" | "probe" | "retryAfterMs"> & {
  openUntil?: number;
  probeUntil?: number;
};

export type CircuitResult = {
  success: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  probe: boolean;
  policy: CircuitPolicy;
};

export interface ProviderCircuitBreakerStore {
  acquire(provider: AIProviderId, policy: CircuitPolicy): Promise<CircuitAdmission>;
  record(provider: AIProviderId, result: CircuitResult): Promise<CircuitSnapshot>;
}

type MemoryEvent = { at: number; success: boolean };
type MemoryRow = CircuitSnapshot & { openCount: number; events: MemoryEvent[] };

/** Deterministic test/local store. Production always uses the shared Supabase store. */
export class InMemoryCircuitBreakerStore implements ProviderCircuitBreakerStore {
  private readonly rows = new Map<AIProviderId, MemoryRow>();

  private row(provider: AIProviderId): MemoryRow {
    let row = this.rows.get(provider);
    if (!row) {
      row = {
        provider,
        state: "closed",
        consecutiveFailures: 0,
        recentAttempts: 0,
        recentFailures: 0,
        recentFailureRate: 0,
        openCount: 0,
        events: [],
      };
      this.rows.set(provider, row);
    }
    return row;
  }

  async acquire(provider: AIProviderId, policy: CircuitPolicy): Promise<CircuitAdmission> {
    const row = this.row(provider);
    const now = Date.now();
    if (row.openUntil !== undefined && row.openUntil > now) {
      return {
        ...row, allowed: false, probe: false,
        retryAfterMs: Math.max(1, row.openUntil - now),
      };
    }
    if (row.openUntil !== undefined) {
      if (row.probeUntil !== undefined && row.probeUntil > now) {
        return {
          ...row, state: "half_open", allowed: false, probe: false,
          retryAfterMs: Math.max(1, row.probeUntil - now),
        };
      }
      row.state = "half_open";
      row.probeUntil = now + 25_000;
      return {
        ...row, state: "half_open", allowed: true, probe: true, retryAfterMs: 0,
      };
    }
    return {
      ...row, state: "closed", allowed: true, probe: false, retryAfterMs: 0,
    };
  }

  async record(provider: AIProviderId, result: CircuitResult): Promise<CircuitSnapshot> {
    const row = this.row(provider);
    const now = Date.now();
    const { policy } = result;
    row.events = row.events.filter((event) => event.at >= now - policy.windowSeconds * 1000);
    row.events.push({ at: now, success: result.success });
    row.recentAttempts = row.events.length;
    row.recentFailures = row.events.filter((event) => !event.success).length;
    row.recentFailureRate = row.recentAttempts
      ? row.recentFailures / row.recentAttempts : 0;

    if (result.success) {
      // A late success from an ordinary request cannot close a circuit another
      // instance has opened. Only the leased half-open probe may do that.
      if (row.openUntil === undefined || result.probe) {
        row.state = "closed";
        row.consecutiveFailures = 0;
        row.openUntil = undefined;
        row.probeUntil = undefined;
        if (result.probe) {
          row.events = [{ at: now, success: true }];
          row.recentAttempts = 1;
          row.recentFailures = 0;
          row.recentFailureRate = 0;
        }
      }
      return this.snapshot(row);
    }

    row.consecutiveFailures += 1;
    const status = Number(result.statusCode);
    const immediate = status === 401 || status === 403 || status === 429;
    const shouldOpen = immediate ||
      row.consecutiveFailures >= policy.failureThreshold ||
      (row.recentAttempts >= policy.minimumRequests &&
        row.recentFailureRate >= policy.failureRateThreshold) ||
      result.probe;

    if (shouldOpen) {
      const previousOpenCount = row.openCount;
      row.openCount += 1;
      const cooldown = status === 429
        ? Math.min(600_000, Math.max(1_000, result.retryAfterMs ?? policy.baseCooldownMs))
        : status === 401 || status === 403
          ? policy.authCooldownMs
          : Math.min(policy.maxCooldownMs, policy.baseCooldownMs * (2 ** Math.min(previousOpenCount, 4)));
      row.state = "open";
      row.openUntil = now + cooldown;
      row.probeUntil = undefined;
    } else {
      row.state = "closed";
      row.probeUntil = undefined;
    }
    return this.snapshot(row);
  }

  private snapshot(row: MemoryRow): CircuitSnapshot {
    const { events: _events, openCount: _openCount, ...snapshot } = row;
    return { ...snapshot };
  }
}

/** Shared service-role-only Supabase storage used by Vercel serverless instances. */
type AdminSupabaseClient = ReturnType<typeof import("../supabase/admin").createAdminClient>;

export class SupabaseCircuitBreakerStore implements ProviderCircuitBreakerStore {
  private client: AdminSupabaseClient | undefined;

  private async getClient(): Promise<AdminSupabaseClient> {
    if (!this.client) {
      const { createAdminClient } = await import("../supabase/admin");
      this.client = createAdminClient();
    }
    return this.client;
  }

  async acquire(provider: AIProviderId, _policy: CircuitPolicy): Promise<CircuitAdmission> {
    const { data, error } = await (await this.getClient()).rpc("get_ai_provider_circuit_state", {
      p_provider: provider,
    });
    if (error || !data || typeof data !== "object") {
      throw new Error("AI_PROVIDER_CIRCUIT_UNAVAILABLE");
    }
    const row = data as Record<string, unknown>;
    const state = row.state === "open" || row.state === "half_open" ? row.state : "closed";
    return {
      provider,
      state,
      allowed: row.allowed === true,
      probe: row.probe === true,
      retryAfterMs: finiteNonNegative(row.retryAfterMs),
      consecutiveFailures: finiteNonNegative(row.consecutiveFailures),
      recentAttempts: finiteNonNegative(row.recentAttempts),
      recentFailures: finiteNonNegative(row.recentFailures),
      recentFailureRate: finiteRate(row.recentFailureRate),
    };
  }

  async record(provider: AIProviderId, result: CircuitResult): Promise<CircuitSnapshot> {
    const { policy } = result;
    const { data, error } = await (await this.getClient()).rpc("record_ai_provider_circuit_result", {
      p_provider: provider,
      p_success: result.success,
      p_status_code: result.statusCode ?? null,
      p_retry_after_ms: result.retryAfterMs ?? 0,
      p_probe: result.probe,
      p_failure_threshold: policy.failureThreshold,
      p_failure_rate_threshold: policy.failureRateThreshold,
      p_minimum_requests: policy.minimumRequests,
      p_window_seconds: policy.windowSeconds,
      p_base_cooldown_ms: policy.baseCooldownMs,
      p_max_cooldown_ms: policy.maxCooldownMs,
      p_auth_cooldown_ms: policy.authCooldownMs,
    });
    if (error || !data || typeof data !== "object") {
      throw new Error("AI_PROVIDER_CIRCUIT_UNAVAILABLE");
    }
    const row = data as Record<string, unknown>;
    const state = row.state === "open" || row.state === "half_open" ? row.state : "closed";
    return {
      provider,
      state,
      consecutiveFailures: finiteNonNegative(row.consecutiveFailures),
      recentAttempts: finiteNonNegative(row.recentAttempts),
      recentFailures: finiteNonNegative(row.recentFailures),
      recentFailureRate: finiteRate(row.recentFailureRate),
      ...(typeof row.openUntil === "string" ? { openUntil: Date.parse(row.openUntil) } : {}),
      ...(typeof row.probeUntil === "string" ? { probeUntil: Date.parse(row.probeUntil) } : {}),
    };
  }
}

function finiteNonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function finiteRate(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}
