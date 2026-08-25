import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { zQuizSyncServerMessage } from '@eduscope/shared';
import type { QuizDb } from '../db/client.js';
import { participants } from '../db/schema.js';
import type { Cancel, Clock } from '../lib/clock.js';
import { chunkAnswers, replayAnswers } from './replay.js';

export type DeviceServerMessage = z.infer<typeof zQuizSyncServerMessage>;

export interface ParticipantCounts {
  joinedCount: number;
  onlineCount: number;
}

/** `joinedCount` is every participant row; `onlineCount` is the live `connection_state` (D-06's student stream owns that transition). */
export async function currentParticipantCounts(db: QuizDb, quizSessionId: string): Promise<ParticipantCounts> {
  const [row] = await db
    .select({
      joinedCount: sql<number>`count(*)::int`,
      onlineCount: sql<number>`count(*) filter (where ${participants.connectionState} = 'online')::int`,
    })
    .from(participants)
    .where(eq(participants.quizSessionId, quizSessionId));
  return { joinedCount: row?.joinedCount ?? 0, onlineCount: row?.onlineCount ?? 0 };
}

const FLUSH_INTERVAL_MS = 1_000;

export interface DeviceBatcherDeps {
  db: QuizDb;
  clock: Clock;
  send(message: DeviceServerMessage): void;
}

/**
 * Coalesces D-05 answer commits and D-04/D-06 connection-state changes into
 * at most one `sync.answers`/`sync.participants` flush per second per
 * connection (events.md §4). `markAnswersDirty`/`markParticipantsDirty` are
 * cheap in-memory flags; the actual rows/counts are always read fresh from
 * PostgreSQL on the next tick, so a dirty flag can never go stale or drift
 * from the authoritative row.
 */
export class DeviceBatcher {
  readonly #deps: DeviceBatcherDeps;
  readonly #quizSessionId: string;
  #watermark: number;
  #answersDirty = false;
  #participantsDirty = false;
  #timer: Cancel | null = null;

  constructor(deps: DeviceBatcherDeps, quizSessionId: string, initialWatermark: number) {
    this.#deps = deps;
    this.#quizSessionId = quizSessionId;
    this.#watermark = initialWatermark;
  }

  start(): void {
    this.#timer = this.#deps.clock.every(FLUSH_INTERVAL_MS, () => void this.#flush());
  }

  stop(): void {
    this.#timer?.cancel();
    this.#timer = null;
  }

  markAnswersDirty(): void {
    this.#answersDirty = true;
  }

  markParticipantsDirty(): void {
    this.#participantsDirty = true;
  }

  async #flush(): Promise<void> {
    if (this.#answersDirty) {
      this.#answersDirty = false;
      const rows = await replayAnswers(this.#deps.db, this.#quizSessionId, this.#watermark);
      for (const chunk of chunkAnswers(rows)) {
        this.#deps.send({ type: 'sync.answers', quizSessionId: this.#quizSessionId, answers: chunk });
        this.#watermark = chunk[chunk.length - 1]!.seq;
      }
    }
    if (this.#participantsDirty) {
      this.#participantsDirty = false;
      const counts = await currentParticipantCounts(this.#deps.db, this.#quizSessionId);
      this.#deps.send({ type: 'sync.participants', quizSessionId: this.#quizSessionId, ...counts });
    }
  }
}
