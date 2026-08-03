import { describe, expect, it } from 'vitest';
import {
  PANEL_EVENT_NAMES,
  PANEL_OPERATION_IDS,
  SERVER_SIDE_ONLY_OPERATION_IDS,
} from '@eduscope/shared';
import { createRealClient } from '../src/index.js';

const client = createRealClient('http://localhost:8080/api/v1') as unknown as Record<
  string,
  unknown
>;

describe('EduscopeClient covers the contract', () => {
  it('implements a method for every panel-facing operation', () => {
    const missing = PANEL_OPERATION_IDS.filter(
      (id) => typeof client[id] !== 'function',
    );
    expect(missing, `no client method for: ${missing.join(', ')}`).toEqual([]);
  });

  it('does NOT implement the server-to-server quiz-sync operations', () => {
    const leaked = SERVER_SIDE_ONLY_OPERATION_IDS.filter((id) => id in client);
    expect(leaked, `quiz-sync leaked into the browser client: ${leaked.join(', ')}`)
      .toEqual([]);
  });

  it('adds no methods beyond the contract plus the realtime surface', () => {
    const allowedExtras = new Set([
      'events$', 'connection$', 'openPreview', 'resync', 'dispose',
    ]);
    const contract = new Set<string>(PANEL_OPERATION_IDS);
    const extras = Object.keys(client).filter(
      (k) => !contract.has(k) && !allowedExtras.has(k),
    );
    expect(extras, `undocumented client surface: ${extras.join(', ')}`).toEqual([]);
  });

  it('exposes a realtime channel typed to the closed event catalog', () => {
    expect(typeof client.events$).toBe('object');
    expect(PANEL_EVENT_NAMES).toHaveLength(22);
  });
});
