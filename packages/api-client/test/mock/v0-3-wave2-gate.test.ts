import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../src/mock/clock.js';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { MockWorld } from '../../src/mock/world.js';
import { ALL_MACHINES, isRecordingNonTerminal } from '../../src/mock/machines/index.js';
import { extendScenario } from '../../src/mock/scenario/registry.js';

/**
 * v0.3 — CG-14..CG-17 (S-06/S-12 wireframe gate, 2026-08-05). Prior to this
 * amendment none of these paths had any coverage: ownerUserId was never set
 * by startRecording, takeoverBy/At/DisplayName were never set by R-21,
 * updateAudioControl had no owner guard, and powerOffDevice always accepted
 * unconditionally (see contract-amendments.md, 2026-08-05).
 */
const at = () => createVirtualClock('2026-08-05T09:00:00.000+00:00');

describe('CG-14 — recording ownership and takeover attribution', () => {
  it('startRecording records the caller as owner (a.perera by default)', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording();
    clock.advance(2_000);
    const snapshot = await client.getRecordingState();
    expect(snapshot.ownerUserId).not.toBeNull();
    expect(snapshot.ownerDisplayName).toBe('A. Perera');
  });

  it('takeoverRecording sets takeoverBy/takeoverAt/takeoverByDisplayName and leaves ownerUserId unchanged (C-1)', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording();
    clock.advance(2_000);
    const before = await client.getRecordingState();

    await client.login({ username: 'admin', password: 'battery-staple', client: 'panel' });
    await client.takeoverRecording();
    clock.advance(1_000);

    const after = await client.getRecordingState();
    expect(after.ownerUserId).toBe(before.ownerUserId); // C-1 — authority transfers, not attribution
    expect(after.takeoverBy).not.toBeNull();
    expect(after.takeoverBy).not.toBe(after.ownerUserId);
    expect(after.takeoverByDisplayName).toBe('Device Administrator');
    expect(after.takeoverAt).not.toBeNull();
  });
});

describe('CG-15 — updateAudioControl is owner-or-admin gated while non-terminal (G-AUTH-OWNER)', () => {
  it('refuses a non-owner, non-admin caller while recording', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording(); // owner: a.perera (default login)
    clock.advance(2_000);

    await client.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' });
    await expect(
      client.updateAudioControl('mic-lecturer', { muted: true }),
    ).rejects.toMatchObject({ problem: { status: 403, code: 'not-authorized' } });
  });

  it('allows the owner', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock }); // default session: a.perera
    await client.startRecording();
    clock.advance(2_000);
    await expect(client.updateAudioControl('mic-lecturer', { muted: true })).resolves.toBeDefined();
  });

  it('allows an admin', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording();
    clock.advance(2_000);
    await client.login({ username: 'admin', password: 'battery-staple', client: 'panel' });
    await expect(client.updateAudioControl('mic-lecturer', { muted: true })).resolves.toBeDefined();
  });

  it('is not gated with no active session', async () => {
    const client = createMockClient('happy', { clock: at() });
    await client.login({ username: 'n.silva', password: 'temp-pass-1', client: 'panel' });
    await expect(client.updateAudioControl('mic-lecturer', { muted: true })).resolves.toBeDefined();
  });
});

describe('CG-16/CG-17 — powerOffDevice: refused while recording, accepted-with-no-resolving-event otherwise', () => {
  it('refuses 409 poweroff.refused while a session is non-terminal, and fires the R-22 alert (CG-17)', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });
    await client.startRecording();
    clock.advance(2_000);

    const alerts: string[] = [];
    client.events$.subscribe((e) => {
      if (e.event === 'system.alert') alerts.push(e.payload.code);
    });

    await expect(client.powerOffDevice()).rejects.toMatchObject({
      problem: { status: 409, code: 'poweroff.refused' },
    });
    expect(alerts).toContain('poweroff.refused');
  });

  it('accepts while idle and closes the transport — no resolving event, the close IS the resolution (C-1)', async () => {
    const clock = at();
    const client = createMockClient('happy', { clock });

    const phases: string[] = [];
    client.connection$.subscribe((s) => phases.push(s.phase));

    await client.powerOffDevice();
    clock.advance(5_000);
    expect(phases).toContain('closed');
  });

  it('replace: "stall" suppresses the close so resolveBySec elapsing reads as not-halted (S-12 §5 state 8)', async () => {
    extendScenario('happy', { on: { command: 'powerOffDevice' }, replace: 'stall', nth: 1 });
    const clock = at();
    const client = createMockClient('happy', { clock });

    const phases: string[] = [];
    client.connection$.subscribe((s) => phases.push(s.phase));

    await client.powerOffDevice();
    clock.advance(15_000); // past RESOLVE_BY_SEC
    expect(phases).not.toContain('closed');
  });
});

describe('CG-14 seed wiring — MockWorld.seedState (the escape hatch bootstrapFromSeed uses for recordingOwnedByOtherUser)', () => {
  it('sets a machine state directly, bypassing apply() legality, and the world stays usable afterward', () => {
    const world = new MockWorld({ clock: at() });
    for (const m of ALL_MACHINES) world.registerMachine(m);

    world.seedState('recording', 'recording');
    expect(world.state('recording')).toBe('recording');
    expect(isRecordingNonTerminal(world)).toBe(true);

    // a real transition legal FROM 'recording' still applies cleanly afterward
    expect(() => world.apply('R-08')).not.toThrow();
    expect(world.state('recording')).toBe('paused');
  });
});
