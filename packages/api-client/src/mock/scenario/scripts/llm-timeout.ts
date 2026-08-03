import type { ScenarioScript } from '../types.js';

/**
 * Q-13 -> Q-05: the LLM is unreachable after retries, the countdown is HELD in
 * `degraded`, and recording plus every other panel function is untouched
 * (LP-18, INV-QS-1, J-2 failure path).
 */
export const llmTimeout: ScenarioScript = {
  name: 'llm-timeout',
  description:
    'Question generation times out. The AI studio shows its unavailable state with ' +
    'a Retry, the countdown holds, and recording is completely unaffected.',
  forced: [
    // Demo-sized: hold `generating` for 4 s instead of T-LLM-REQUEST's 45 s.
    { on: { transition: 'Q-12' }, replace: 'Q-13', delayMs: 4_000 },
    { on: { transition: 'Q-14' }, replace: 'Q-05' },
    {
      on: { command: 'generateNow' },
      nth: 2,
      replace: 'refuse',
      refusal: {
        status: 409,
        code: 'ai.unavailable',
        title: 'The question service is not responding',
        detail: 'Recording is unaffected. Try again in a moment.',
      },
    },
  ],
};
