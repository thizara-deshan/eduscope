import type { z } from 'zod';
import type { User } from '@eduscope/shared';
import type { WorldSeed } from '../scenario/types.js';
import type { Clock } from '../clock.js';
import { createUsersSeed } from './users.js';
import { createDeviceSeed, type DeviceSeed } from './device.js';
import { createSourcesSeed, type SourcesSeed } from './sources.js';
import { createRecordingsSeed, type RecordingsSeed } from './recordings.js';
import { createAiSeed, type AiSeed } from './ai.js';

/**
 * THE contract-honesty gate (frontend-conventions §5). Every value the mock
 * hands back goes through here, so a mock that drifts from contracts/ fails at
 * the moment it is constructed rather than in a screen three waves later.
 */
export function validated<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `mock response violates the contract:\n${JSON.stringify(result.error.format(), null, 2)}`,
    );
  }
  return result.data;
}

/**
 * `rest.ts`'s `zInstant` (used by nearly every entity schema) is the strict
 * Z-only variant — see world.ts's own comment on `buildAlert.raisedAt` for the
 * same gotcha. `Clock.nowIso()` always appends a `+00:00` offset (it feeds
 * `zEventInstant`, the WS-only offset-tolerant variant), so any REST fixture
 * built at request time from the clock must go through this instead of
 * `clock.nowIso()` directly.
 */
export function nowIsoZ(clock: Pick<Clock, 'now'>): string {
  return new Date(clock.now()).toISOString();
}

/** Deterministic ULID-shaped fixture ids — seed construction has no MockWorld/clock to hang `nextUlid` off of. */
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let seedIdCounter = 0;
export function seedId(tag: string): string {
  seedIdCounter += 1;
  const raw = `${tag}${seedIdCounter}`.toUpperCase().replace(/[^0-9A-Z]/g, '');
  const mapped = [...raw].map((c) => (ULID_ALPHABET.includes(c) ? c : '0')).join('');
  return mapped.padEnd(26, '0').slice(0, 26);
}

/** A fixed, past, Z-suffixed instant for "provisioned at / registered at"-style fixture fields. */
export const SEED_EPOCH = '2026-01-15T08:00:00.000Z';

/** Shared by seed/recordings.ts and seed/ai.ts so a seeded Recording and its AI/quiz fixtures agree on one lecture session. */
export const SEED_LECTURE_SESSION_ID = seedId('lecture-session');

export interface Seed extends DeviceSeed, SourcesSeed, RecordingsSeed, AiSeed {
  readonly users: User[];
}

/**
 * Builds the mock's starting entity graph. `overrides` are the scenario
 * script's `WorldSeed` (state-machines-adjacent knobs like `storagePressure`
 * / `aiEnabled`) — `createRestOperations`'s consumers pass the same object a
 * `ScenarioScript.seed` carries. `recordingOwnedByOtherUser` is a *live*
 * world concept (whose session is currently open), not a fixture shape, so
 * it is accepted here for signature completeness but not consumed by any
 * seed builder — a later task's client wiring is the place that would apply
 * it to `world.data`.
 */
export function createSeed(overrides: Partial<WorldSeed> = {}): Seed {
  const users = createUsersSeed();
  const seed: Seed = {
    users,
    ...createDeviceSeed(overrides),
    ...createSourcesSeed(overrides),
    ...createRecordingsSeed(users),
    ...createAiSeed(),
  };
  return Object.freeze(seed);
}
