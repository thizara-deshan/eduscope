import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_MACHINES } from '../../src/mock/machines/index.js';

const doc = readFileSync(
  resolve(__dirname, '../../../../docs/design/state-machines.md'),
  'utf8',
);

/** Transition-table rows look like: `| R-05 | starting | … |` */
function documentedIds(prefix: string): string[] {
  return [
    ...new Set(
      [...doc.matchAll(new RegExp(`^\\| (${prefix}-\\d+) \\|`, 'gm'))].map((m) => m[1]!),
    ),
  ];
}

const implemented = new Set(
  ALL_MACHINES.flatMap((m) => m.transitions.map((t) => t.id)),
);

/**
 * Machines 4b (QuizParticipant) and 4c (per-student answer view) run on
 * quiz-service, not core-api — state-machines §0.2 names quiz-service as their
 * single writer. apps/quiz mocks them; this adapter must not.
 */
const QUIZ_SERVICE_SIDE = new Set([
  'Z-10', 'Z-11', 'Z-12', 'Z-13', 'Z-14', 'Z-15',
  'Z-20', 'Z-21', 'Z-22', 'Z-23', 'Z-24', 'Z-25', 'Z-26',
]);

describe('machine definitions mirror state-machines.md', () => {
  it.each(['R', 'CH', 'Q', 'Z', 'HL'])(
    'implements every %s-xx transition core-api owns',
    (prefix) => {
      const ids = documentedIds(prefix).filter((id) => !QUIZ_SERVICE_SIDE.has(id));
      expect(ids.length).toBeGreaterThan(0);
      const missing = ids.filter((id) => !implemented.has(id));
      expect(missing, `unimplemented transitions: ${missing.join(', ')}`).toEqual([]);
    },
  );

  it('does not implement the quiz-service-owned machines (SM-R-1: one writer)', () => {
    const leaked = [...QUIZ_SERVICE_SIDE].filter((id) => implemented.has(id));
    expect(leaked, `core-api mock claims quiz-service transitions: ${leaked.join(', ')}`)
      .toEqual([]);
  });

  it('cites a spec section on every transition', () => {
    const uncited = ALL_MACHINES.flatMap((m) => m.transitions)
      .filter((t) => !/state-machines §/.test(t.cite))
      .map((t) => t.id);
    expect(uncited, `missing citation: ${uncited.join(', ')}`).toEqual([]);
  });

  it('declares no duplicate transition ids across machines', () => {
    const all = ALL_MACHINES.flatMap((m) => m.transitions.map((t) => t.id));
    expect(all.length).toBe(new Set(all).size);
  });

  it('gives every non-initial state at least one inbound transition', () => {
    for (const m of ALL_MACHINES) {
      const reachable = new Set([m.initial, ...m.transitions.map((t) => t.to)]);
      for (const t of m.transitions) {
        for (const from of t.from) {
          if (from === '*') continue;
          expect(reachable.has(from), `${m.id}: ${t.id} starts from unreachable "${from}"`)
            .toBe(true);
        }
      }
    }
  });
});
