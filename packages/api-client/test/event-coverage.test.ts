import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PANEL_EVENT_NAMES, zEventEnvelope } from '@eduscope/shared';
import { createVirtualClock } from '../src/mock/clock.js';
import { createMockClient } from '../src/mock/create-mock-client.js';
import { listScenarios } from '../src/mock/scenario/registry.js';

/**
 * 100 % of contract EVENTS, from the client's side of the boundary.
 *
 * `packages/shared` proves the zod union mirrors `events.md`; this proves the
 * thing a screen actually consumes — `client.events$` — speaks that union and
 * nothing else. A payload the panel can never receive is as much a hole as one
 * the mock never emits.
 */
const catalog = readFileSync(resolve(__dirname, '../../../contracts/events.md'), 'utf8');
const catalogEventNames = () =>
  [...catalog.matchAll(/^### 2\.\d+ `([a-z.]+)`/gm)].map((m) => m[1]!);

describe('event coverage', () => {
  it('declares every event catalogued in contracts/events.md §2', () => {
    const missing = catalogEventNames().filter(
      (name) => !(PANEL_EVENT_NAMES as readonly string[]).includes(name),
    );
    expect(missing, `undeclared events: ${missing.join(', ')}`).toEqual([]);
  });

  it('declares no event the catalog does not define', () => {
    const catalogued = new Set(catalogEventNames());
    // events.md §4's StudentServerEvent names are quiz-app-facing and are
    // catalogued in their own section, not §2 — they ride the same union.
    const studentFacing = new Set(['quiz.question', 'quiz.result', 'quiz.participant']);
    const invented = PANEL_EVENT_NAMES.filter(
      (n) => !catalogued.has(n) && !studentFacing.has(n),
    );
    expect(invented, `invented events: ${invented.join(', ')}`).toEqual([]);
  });

  it('emits only envelopes that parse as the contract union, on every script', () => {
    for (const script of listScenarios()) {
      const client = createMockClient(script.name, {
        clock: createVirtualClock('2026-07-30T09:00:00.000+00:00'),
      });
      const seen: string[] = [];
      const off = client.events$.subscribe((e) => {
        const parsed = zEventEnvelope.safeParse(e);
        expect(
          parsed.success,
          `${script.name}: ${e.event} failed its schema — ${JSON.stringify(parsed.error?.issues)}`,
        ).toBe(true);
        seen.push(e.event);
      });
      // The on-subscribe snapshot alone must already describe a renderable
      // world: a cold panel has no other source of state (events.md §1).
      expect(seen.length, `${script.name} replayed no snapshot`).toBeGreaterThan(0);
      off();
      client.dispose();
    }
  });

  it('replays the snapshot in strictly non-decreasing seq order', () => {
    const client = createMockClient('happy', {
      clock: createVirtualClock('2026-07-30T09:00:00.000+00:00'),
    });
    const seqs: number[] = [];
    const off = client.events$.subscribe((e) => seqs.push(e.seq));
    off();
    client.dispose();
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
