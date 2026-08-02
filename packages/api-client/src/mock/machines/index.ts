import { recordingMachine } from './recording.js';
import { meetingChannelMachine, streamingChannelMachine } from './channel.js';
import { aiCountdownMachine, aiPublicationMachine, aiQuestionMachine, aiSetMachine } from './ai.js';
import { quizSessionMachine, quizSyncMachine } from './quiz.js';
import { captureCardMachine, sourceMachine, storageMachine } from './health.js';
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
 * `HL-23` being "unimplemented". See ai.ts's and health.ts's module comments.
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

export { recordingMachine, sourceMachine, storageMachine, captureCardMachine };
export { meetingChannelMachine, streamingChannelMachine };
export { aiCountdownMachine, aiSetMachine, aiQuestionMachine, aiPublicationMachine };
export { quizSessionMachine, quizSyncMachine };
