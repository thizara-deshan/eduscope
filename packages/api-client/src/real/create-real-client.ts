import { PANEL_OPERATION_IDS } from '@eduscope/shared';
import type { EduscopeClient } from '../client.js';
import { NotImplementedError } from '../errors.js';

/**
 * Phase-4 placeholder. Every operation throws.
 *
 * This exists so the interface is HONEST: `EduscopeClient` claims to describe a
 * real backend, and until one exists that claim must fail loudly rather than
 * quietly resolve. Do not add fetch calls here in Phase 2 — the mock adapter is
 * the Phase-2 implementation.
 */
export function createRealClient(baseUrl: string): EduscopeClient {
  void baseUrl;
  const client = {} as Record<string, unknown>;

  for (const id of PANEL_OPERATION_IDS) {
    client[id] = () => {
      throw new NotImplementedError(id);
    };
  }

  const deadStream = {
    subscribe() {
      throw new NotImplementedError('events$.subscribe');
    },
  };

  client.events$ = deadStream;
  client.connection$ = deadStream;
  client.openPreview = () => {
    throw new NotImplementedError('openPreview');
  };
  client.resync = () => {
    throw new NotImplementedError('resync');
  };
  client.dispose = () => {};

  return client as unknown as EduscopeClient;
}
