import type { AIProviderId } from "./types";

export type CircuitState = "closed" | "open" | "half_open";

export type CircuitSnapshot = {
  provider: AIProviderId;
  state: CircuitState;
  consecutiveFailures: number;
  openedAt?: number;
  lastFailureAt?: number;
  probeInFlight: boolean;
};

export interface CircuitBreakerStore {
  read(provider: AIProviderId): Promise<CircuitSnapshot>;
  write(snapshot: CircuitSnapshot): Promise<void>;
}

/**
 * Test/local implementation only. Production serverless deployments need a shared
 * persistent store (Supabase RPC/table) before circuit breaking is enabled.
 */
export class InMemoryCircuitBreakerStore implements CircuitBreakerStore {
  private readonly snapshots = new Map<AIProviderId, CircuitSnapshot>();

  async read(provider: AIProviderId): Promise<CircuitSnapshot> {
    return this.snapshots.get(provider) ?? {
      provider, state: "closed", consecutiveFailures: 0, probeInFlight: false,
    };
  }

  async write(snapshot: CircuitSnapshot): Promise<void> {
    this.snapshots.set(snapshot.provider, { ...snapshot });
  }
}

export class ProviderCircuitBreaker {
  constructor(
    private readonly store: CircuitBreakerStore,
    private readonly failureThreshold = 5,
    private readonly resetAfterMs = 30_000,
  ) {}

  async canRequest(provider: AIProviderId, now = Date.now()): Promise<boolean> {
    const snapshot = await this.store.read(provider);
    if (snapshot.state === "closed") return true;
    if (snapshot.state === "open") {
      if (!snapshot.openedAt || now - snapshot.openedAt < this.resetAfterMs) return false;
      await this.store.write({ ...snapshot, state: "half_open", probeInFlight: false });
    }
    const halfOpen = await this.store.read(provider);
    if (halfOpen.probeInFlight) return false;
    await this.store.write({ ...halfOpen, state: "half_open", probeInFlight: true });
    return true;
  }

  async recordSuccess(provider: AIProviderId): Promise<void> {
    await this.store.write({ provider, state: "closed", consecutiveFailures: 0, probeInFlight: false });
  }

  async recordFailure(provider: AIProviderId, now = Date.now()): Promise<void> {
    const current = await this.store.read(provider);
    const failures = current.consecutiveFailures + 1;
    const open = current.state === "half_open" || failures >= this.failureThreshold;
    await this.store.write({
      provider,
      state: open ? "open" : "closed",
      consecutiveFailures: failures,
      openedAt: open ? now : current.openedAt,
      lastFailureAt: now,
      probeInFlight: false,
    });
  }
}
