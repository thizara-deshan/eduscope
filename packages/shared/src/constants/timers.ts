/** state-machines.md §9 — milliseconds. No value here is invented. */
export const TIMERS = {
  'T-START-CONFIRM': 5_000,
  'T-RESUME-CONFIRM': 3_000,
  'T-PAUSE-EOS': 5_000,
  'T-STOP-EOS': 8_000,
  'T-SESSION-HEARTBEAT': 5_000,
  'T-RECOVERY-WINDOW': 600_000,
  'T-BOOT-RECOVERY': 20_000,
  /** §9 — first step of the 1s/3s/8s backoff below; recording.ts falls back
   * to the same 1s value via `?? 1_000` if this key were ever removed. */
  'T-CONSUMER-RESTART': 1_000,
  'T-CHANNEL-START': 6_000,
  'T-STORAGE-PROBE-REC': 10_000,
  'T-STORAGE-PROBE-IDLE': 60_000,
  'T-HEALTH-STALE': 6_000,
  'T-SOURCE-DEGRADE': 2_000,
  'T-SOURCE-OFFLINE': 10_000,
  'T-SOURCE-DEBOUNCE': 3_000,
  'T-CAPTURE-PROBE': 30_000,
  'T-CAPTURE-RECOVER': 25_000,
  'T-LLM-REQUEST': 45_000,
  'T-LLM-PROBE': 60_000,
  'T-COUNTDOWN-RESYNC': 15_000,
  'T-PUBLISH-ACK': 5_000,
  'T-QUIZ-CREATE': 8_000,
  'T-QUIZ-PROBE': 30_000,
  'T-QUIZ-HEARTBEAT': 5_000,
  'T-QUIZ-SYNC-STALE': 15_000,
  'T-QUIZ-SYNC-FAIL': 60_000,
  'T-WS-STALE': 10_000,
  'T-CMD-RESOLVE': 10_000,
  'T-UPLOAD-STALL': 60_000,
  'T-ALERT-REEVALUATE': 30_000,
} as const;

export type TimerId = keyof typeof TIMERS;

/** §9 T-CONSUMER-RESTART — 1 s, 3 s, 8 s, max 3 attempts / 120 s. */
export const CONSUMER_RESTART_BACKOFF_MS = [1_000, 3_000, 8_000] as const;

/** §9 T-LLM-RETRY — 2 automatic retries. */
export const LLM_RETRY_BACKOFF_MS = [10_000, 30_000] as const;

/** §9 T-WS-RECONNECT — 0.5, 1, 2, 4, 8 s, capped 10 s, unlimited attempts. */
export const WS_RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000, 10_000] as const;
