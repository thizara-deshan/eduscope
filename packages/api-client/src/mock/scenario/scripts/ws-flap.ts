import { BOUND_SOURCE_ROLES } from '../../machines/index.js';
import { sourceTransitionId } from '../../machines/health.js';
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
    'reconnect forces a full snapshot resync. Before the first drop the telemetry goes ' +
    'stale with the socket still OPEN, so every source reads "checking" — never the last ' +
    'healthy value (HL-08, INV-DH-2).',
  forced: [],
  // S-05 §10: "the socket is fine but the data is old" is the one input for
  // which that distinction is the whole point, and it was untestable.
  timeline: [
    ...BOUND_SOURCE_ROLES.map((roleId, i) => ({
      transition: sourceTransitionId(roleId, 'HL-08'),
      afterMs: 5_000 + i * 200,
    })),
    ...BOUND_SOURCE_ROLES.map((roleId, i) => ({
      transition: sourceTransitionId(roleId, 'HL-02'),
      afterMs: 11_000 + i * 200,
    })),
  ],
  wsFlap: { afterMs: 15_000, downMs: 12_000, repeat: 3 },
};
