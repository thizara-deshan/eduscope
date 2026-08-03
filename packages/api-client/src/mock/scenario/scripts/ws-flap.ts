import type { ScenarioScript } from '../types.js';

/**
 * events.md §1 / state-machines §5.5: the socket drops and reconnects. The panel
 * must dim live regions after T-WS-STALE, KEEP the recording frame, reject
 * commands client-side, and full-resync on a seq gap — never partial-patch.
 */
export const wsFlap: ScenarioScript = {
  name: 'ws-flap',
  description:
    'The panel loses the event socket three times. Live regions dim after 10 s, the ' +
    'recording frame is kept, commands are rejected rather than queued, and each ' +
    'reconnect forces a full snapshot resync.',
  forced: [],
  wsFlap: { afterMs: 15_000, downMs: 12_000, repeat: 3 },
};
