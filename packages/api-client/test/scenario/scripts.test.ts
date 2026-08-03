import { describe, expect, it } from 'vitest';
import { listScenarios } from '../../src/mock/scenario/registry.js';

describe('scenario scripts', () => {
  it('every script has a human description the overlay can render', () => {
    for (const s of listScenarios()) {
      expect(s.description.length, `${s.name} has no description`).toBeGreaterThan(20);
    }
  });

  it('every refuse-on-command rule carries a named Problem (U-5)', () => {
    for (const s of listScenarios()) {
      for (const f of s.forced) {
        if ('command' in f.on && f.replace === 'refuse') {
          expect(f.refusal, `${s.name}: refuse without a Problem`).toBeDefined();
          expect(f.refusal!.code, `${s.name}: refusal has no machine code`).toBeTruthy();
        }
      }
    }
  });

  it('only ws-flap manipulates the socket', () => {
    for (const s of listScenarios()) {
      if (s.name === 'ws-flap') expect(s.wsFlap).toBeDefined();
      else expect(s.wsFlap, `${s.name} must not flap the socket`).toBeUndefined();
    }
  });

  it('disk-full seeds critical pressure so Start is refused before it is pressed', () => {
    const s = listScenarios().find((x) => x.name === 'disk-full')!;
    expect(s.seed?.storagePressure).toBe('critical');
  });
});
