import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, FirmwareUpdate } from '@eduscope/shared';
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

describe('Wave 6, Task 8 — firmware lifecycle + firmware.state emission', () => {
  it('checkFirmware with firmwareOutcome:up-to-date leaves availableVersion null', async () => {
    const client = createMockClient('happy', { seed: { firmwareOutcome: 'up-to-date' } });
    await loginAdmin(client);
    const emits = eventsOf<FirmwareUpdate>(client, 'firmware.state');
    await client.checkFirmware();
    await vi.waitFor(() => expect(emits.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 1_100));
    const state = await client.getFirmwareState();
    expect(state.availableVersion).toBeNull();
    client.dispose();
  });

  it('checkFirmware emits firmware.state on state change', async () => {
    const client = createMockClient('happy', { seed: { firmwareOutcome: 'update-available' } });
    await loginAdmin(client);
    const emits = eventsOf<FirmwareUpdate>(client, 'firmware.state');
    await client.checkFirmware();
    expect(emits.some((e) => e.state === 'checking')).toBe(true);
    client.dispose();
  });
});
