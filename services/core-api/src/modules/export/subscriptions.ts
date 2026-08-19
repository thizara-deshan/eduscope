import type { Clock } from '../../lib/clock.js';

export type ScopedStream = 'usb.volumes' | 'export.job' | 'log.entry';

interface Subscription {
  stream: ScopedStream;
  scope: string | null;
  expiresAtMs: number;
}

export class ScopedSubscriptionRegistry {
  readonly #clock: Clock;
  readonly #ttlMs: number;
  readonly #entries = new Map<string, Subscription[]>();

  constructor(clock: Clock, ttlMs = 120_000) {
    this.#clock = clock;
    this.#ttlMs = ttlMs;
  }

  refresh(authSessionId: string, stream: ScopedStream, scope?: string): void {
    const entries = this.#entries.get(authSessionId) ?? [];
    const existing = entries.find((entry) => entry.stream === stream && entry.scope === (scope ?? null));
    const expiresAtMs = this.#clock.now().getTime() + this.#ttlMs;
    if (existing) existing.expiresAtMs = expiresAtMs;
    else entries.push({ stream, scope: scope ?? null, expiresAtMs });
    this.#entries.set(authSessionId, entries);
  }

  allows(authSessionId: string, stream: ScopedStream, scope?: string): boolean {
    const now = this.#clock.now().getTime();
    const entries = (this.#entries.get(authSessionId) ?? []).filter((entry) => entry.expiresAtMs > now);
    if (entries.length) this.#entries.set(authSessionId, entries);
    else this.#entries.delete(authSessionId);
    return entries.some((entry) => entry.stream === stream && entry.scope === (scope ?? null));
  }

  clear(authSessionId: string): void { this.#entries.delete(authSessionId); }
}
