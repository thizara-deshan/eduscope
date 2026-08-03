import { describe, expect, it } from 'vitest';
import { PANEL_OPERATION_IDS } from '@eduscope/shared';
import { NotImplementedError, createRealClient } from '../src/index.js';

describe('createRealClient is an honest Phase-4 stub', () => {
  const client = createRealClient('http://localhost:8080/api/v1') as unknown as Record<
    string,
    (...a: unknown[]) => unknown
  >;

  it.each(PANEL_OPERATION_IDS)('%s throws NotImplementedError("Phase 4")', (id) => {
    let thrown: unknown;
    try {
      client[id]!();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NotImplementedError);
    expect((thrown as Error).message).toContain('Phase 4');
    expect((thrown as Error).message).toContain(id);
  });

  it('throws rather than silently returning a dead subscription', () => {
    expect(() =>
      (client.events$ as unknown as { subscribe: () => void }).subscribe(),
    ).toThrow(NotImplementedError);
  });
});
