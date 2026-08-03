import type { ScenarioScript } from '../types.js';

/**
 * Machine 4d Z-30 -> Z-32: the device<->quiz-service link goes stale then fails.
 * Responses are MARKED stale rather than shown as current (INV-AP-2), sent
 * questions stay on the projector, and recording is untouched (QZ-7).
 */
export const quizNetworkLoss: ScenarioScript = {
  name: 'quiz-network-loss',
  description:
    'The link to the campus quiz server drops. Insights mark responses stale instead ' +
    'of fabricating them, Send to Projector is refused with a named reason, and the ' +
    'lecture recording continues normally.',
  forced: [
    { on: { transition: 'Z-31' }, replace: 'Z-32' },
    {
      on: { command: 'sendToProjector' },
      replace: 'refuse',
      refusal: {
        status: 409,
        code: 'quiz.unavailable',
        title: 'Students cannot receive this question right now',
        detail: 'The quiz server is unreachable. The projector stayed on your slides.',
      },
    },
  ],
};
