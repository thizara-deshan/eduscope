import { recordingMachine, isRecordingNonTerminal } from './recording.js';
import { channelTransitionId, meetingChannelMachine, streamingChannelMachine } from './channel.js';
import { aiCountdownMachine, aiPublicationMachine, aiQuestionMachine, aiSetMachine } from './ai.js';
import { quizSessionMachine, quizSyncMachine } from './quiz.js';
import { captureCardMachine, sourceMachine, sourceTransitionId, storageMachine } from './health.js';
import type { MachineDef } from './types.js';
import type { SourceRoleId } from '@eduscope/shared';

/** V1 binds four roles; mic-room is permanently unbound (INV-SR-2, A-08 amended). */
export const BOUND_SOURCE_ROLES: readonly SourceRoleId[] = [
  'presentation',
  'lecturer-cam',
  'students-cam',
  'mic-lecturer',
];

/**
 * `aiQuestionMachine` (2c, `Question`'s audit contract) and `captureCardMachine`
 * (5c, the capture-card watchdog, `HL-20`…`HL-23`) are not in the brief's
 * given index.ts snippet — its Step 5 prose only calls out 2a/2b/2d for
 * ai.ts and 5a/5b for health.ts. But the test's own documented-id sweep pulls
 * in every `Q-xx` and `HL-xx` row in the doc (no exclusion list for either
 * prefix, unlike Z's quiz-service skip list), so 2c and 5c must be
 * registered too or `machines.test.ts` fails on `Q-18`..`Q-23` / `HL-20`..
 * `HL-23` being "unimplemented".
 *
 * **Transition-id scheme for multi-instance machines.** `world.ts` keys
 * every transition in one flat, registry-wide `Map<TransitionId, Transition>`
 * (see its `registerMachine`/`apply`), and `machines.test.ts` asserts no two
 * transitions anywhere in `ALL_MACHINES` share an id. That's fine for
 * single-instance machines (recording, the four AI machines, both quiz
 * machines, storage, the capture-card watchdog) but two machines here have
 * *multiple runtime instances built from one doc-level id vocabulary*:
 *
 * - **Channels** (`channel.ts`, machine 1c): the doc's `CH-01`..`CH-10` table
 *   describes "the channel consumer" generically, applicable to both
 *   `meeting` and `streaming`. `channel:meeting` keeps the canonical bare ids
 *   `CH-04`..`CH-10` (fixed by `CH-04`'s own doc row, which already wires
 *   `fire('CH-05', 700)`); `channel:streaming` owns `CH-01`..`CH-03` plus
 *   reimplements the shared `CH-05`..`CH-10` tail under `CH-05S`..`CH-10S`.
 *   Resolve with `channelTransitionId(channelId, bareId)` — do not
 *   hand-build a suffixed id.
 * - **Source roles** (`health.ts`, machine 5a): `HL-01`..`HL-09` is called
 *   once per bound role (4×). `presentation` (`BOUND_SOURCE_ROLES[0]`) keeps
 *   the bare ids; every other role gets an `@<roleId>` suffix (e.g.
 *   `HL-02@lecturer-cam`). Resolve with `sourceTransitionId(roleId, bareId)`.
 *
 * Both resolvers are re-exported below. A future task addressing a specific
 * channel or source-role transition (e.g. a scenario script driving
 * `world.apply(...)`) should call the resolver rather than assume the bare
 * doc id always applies.
 */
export const ALL_MACHINES: readonly MachineDef[] = [
  recordingMachine,
  meetingChannelMachine,
  streamingChannelMachine,
  aiCountdownMachine,
  aiSetMachine,
  aiQuestionMachine,
  aiPublicationMachine,
  quizSessionMachine,
  quizSyncMachine,
  storageMachine,
  captureCardMachine,
  ...BOUND_SOURCE_ROLES.map(sourceMachine),
];

export { recordingMachine, isRecordingNonTerminal, sourceMachine, sourceTransitionId, storageMachine, captureCardMachine };
export { meetingChannelMachine, streamingChannelMachine, channelTransitionId };
export { aiCountdownMachine, aiSetMachine, aiQuestionMachine, aiPublicationMachine };
export { quizSessionMachine, quizSyncMachine };
