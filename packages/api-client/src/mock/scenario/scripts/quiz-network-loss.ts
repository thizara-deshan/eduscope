import type { ScenarioScript } from '../types.js';

/**
 * Machine 4d Z-30 -> Z-32: the device<->quiz-service link goes stale then fails.
 * Responses are MARKED stale rather than shown as current (INV-AP-2), sent
 * questions stay on the projector, and recording is untouched (QZ-7).
 *
 * CG-19 (S-20 §10, row 1): the joined-count staleness must be demonstrable. The
 * quiz session is opened by record-start itself (W4-D-1, `R-05`'s Z-01 schedule)
 * — this script's own `timeline` only needs to DRIVE Z-30 (sync `stale`) once
 * that has happened. With CG-19 on `quiz.session`, Z-30 re-emits that event
 * carrying `syncState: stale`, so S-20's chip/modal flip to the stale rendering
 * LIVE (the joined count freezes and is marked out of date) rather than only on
 * the next REST snapshot. Z-31 is left for a future timeline to drive — the
 * forced `Z-31 -> Z-32` rule below stands ready but is not scheduled here,
 * keeping this run to the CG-19 stale state.
 */
export const quizNetworkLoss: ScenarioScript = {
  name: 'quiz-network-loss',
  description:
    'The link to the campus quiz server drops. The quiz join count goes stale and is ' +
    'marked out of date, Insights mark responses stale instead of fabricating them, ' +
    'Send to Projector is refused with a named reason, and the lecture recording ' +
    'continues normally.',
  timeline: [
    { transition: 'Z-30', afterMs: 3_000 }, // synced -> stale, once the session is open
  ],
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
