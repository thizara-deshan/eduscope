import { describe, expect, it } from 'vitest';
import type { EventEnvelope, LogEntry } from '@eduscope/shared';
import { createMockClient } from '../../src/mock/create-mock-client.js';

function eventsOf<T>(client: ReturnType<typeof createMockClient>, event: string) {
  const seen: T[] = [];
  client.events$.subscribe((e: EventEnvelope) => {
    if (e.event === event) seen.push(e.payload as T);
  });
  return seen;
}

async function loginAdmin(client: ReturnType<typeof createMockClient>) {
  await client.login({ username: 'admin', password: 'battery-staple', client: 'panel' });
}

describe('Wave 6, Task 11 — log-tail emission', () => {
  it('queryLogs schedules log.entry emits once, not on every call', async () => {
    const client = createMockClient('happy');
    await loginAdmin(client);
    const emits = eventsOf<LogEntry>(client, 'log.entry');
    await client.queryLogs({});
    await client.queryLogs({ level: 'WARN' });
    await new Promise((r) => setTimeout(r, 5_000));
    expect(emits.length).toBe(3);
    client.dispose();
  }, 10_000);
});
