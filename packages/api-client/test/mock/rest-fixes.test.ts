import { describe, expect, it } from 'vitest';
import type { EventEnvelope } from '@eduscope/shared';
import type { EduscopeClient } from '../../src/client.js';
import { createVirtualClock } from '../../src/mock/clock.js';
import { MockWorld } from '../../src/mock/world.js';
import { ALL_MACHINES } from '../../src/mock/machines/index.js';
import { createScenarioEngine } from '../../src/mock/scenario/engine.js';
import { getScenario } from '../../src/mock/scenario/registry.js';
import { createSeed } from '../../src/mock/seed/index.js';
import { createCredentialStore } from '../../src/mock/seed/users.js';
import { createRestOperations } from '../../src/mock/rest/index.js';

/**
 * `contract-honesty.test.ts` can't run yet (blocked on Task 12's
 * `create-mock-client.ts`), so this builds the same MockWorld + ScenarioEngine
 * + Seed + createRestOperations stack by hand — proof for the 5 fixes from
 * the task-10 review round (C1, I2, I3, I4, I5). See task-10-report.md.
 *
 * `createRestOperations`'s own return type is deliberately loose
 * (`Record<PanelOperationId, (...args: never[]) => Promise<unknown>>` —
 * rest/index.ts's own assembler cast) since 77 heterogeneous signatures
 * don't fit one function type; this is the same boundary-cast Task 12's
 * `create-mock-client.ts` will need to do to hand back a typed
 * `EduscopeClient`, done here only for test ergonomics.
 *
 * Uses a `VirtualClock` and never calls `.advance()`: scheduled transitions
 * (`world.schedule`) sit in the clock's pending map instead of firing on a
 * real OS timer, so nothing here risks the known/deferred issue where a
 * `COMMAND_PLANS` step fires from an illegal machine state (that issue is
 * inherited from the brief's own design — flagged for Task 12 in
 * task-10-report.md, not something this test suite exercises or fixes).
 */
function build() {
  const world = new MockWorld({ clock: createVirtualClock('2026-08-03T09:00:00.000Z') });
  for (const m of ALL_MACHINES) world.registerMachine(m);
  const engine = createScenarioEngine(getScenario('happy'));
  const seed = createSeed();
  const ops = createRestOperations({
    world,
    engine,
    seed,
    worldSeed: {
      storagePressure: 'ok',
      aiEnabled: true,
      quizAvailable: true,
      recordingOwnedByOtherUser: false,
      audioApplyFails: false,
    },
    credentials: createCredentialStore(),
  }) as unknown as EduscopeClient;
  return { world, ops, seed };
}

async function loginAsAdmin(ops: EduscopeClient) {
  await ops.login({ username: 'admin', password: 'battery-staple', client: 'admin' });
}

describe('C1 — CommandAccepted.acceptedAt is a valid (Z-suffixed) instant', () => {
  it('every 202 command in recording.ts resolves without throwing', async () => {
    const { ops } = build();
    const accepted = await ops.startRecording();
    expect(accepted.commandId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(accepted.acceptedAt.endsWith('Z')).toBe(true);
    await ops.pauseRecording();
    await ops.resumeRecording();
    await ops.stopRecording();
    await loginAsAdmin(ops);
    await ops.takeoverRecording();
  });
});

describe('I2 — takeoverRecording / deleteRecording are admin-gated', () => {
  it('a lecturer session gets 403 on takeoverRecording', async () => {
    const { ops } = build(); // default session is the seeded lecturer
    await expect(ops.takeoverRecording()).rejects.toMatchObject({
      problem: { status: 403, code: 'not-authorized' },
    });
  });

  it('a lecturer session gets 403 on deleteRecording', async () => {
    const { ops, seed } = build();
    await expect(ops.deleteRecording(seed.recordings[0]!.id)).rejects.toMatchObject({
      problem: { status: 403, code: 'not-authorized' },
    });
  });

  it('an admin session can do both', async () => {
    const { ops, seed } = build();
    await loginAsAdmin(ops);
    await ops.takeoverRecording();
    const deletable = seed.recordings.find((r) => r.state !== 'deleted')!;
    await ops.deleteRecording(deletable.id);
    expect(deletable.state).toBe('deleted');
  });
});

describe('I3 — ai.ts commands validate the entity before scheduling', () => {
  it('sendToProjector with a bogus id 404s and does NOT drive the publication machine', async () => {
    const { world, ops } = build();
    const events: EventEnvelope[] = [];
    world.subscribeEvents((e) => events.push(e));

    await expect(ops.sendToProjector('01BOGUSQUESTIONID00000000')).rejects.toMatchObject({
      problem: { status: 404 },
    });

    expect(events).toHaveLength(0); // no quiz.publication / ai.question broadcast for a failed command
  });

  it('editQuestion/discardQuestion with a bogus id 404 without scheduling', async () => {
    const { world, ops } = build();
    const events: EventEnvelope[] = [];
    world.subscribeEvents((e) => events.push(e));

    await expect(ops.editQuestion('01BOGUS00000000000000000A', { prompt: 'x' })).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(ops.discardQuestion('01BOGUS00000000000000000A')).rejects.toMatchObject({
      problem: { status: 404 },
    });
    expect(events).toHaveLength(0);
  });

  it('closePublication with a bogus id 404s without scheduling', async () => {
    const { world, ops } = build();
    const events: EventEnvelope[] = [];
    world.subscribeEvents((e) => events.push(e));

    await expect(ops.closePublication('01BOGUS00000000000000000A')).rejects.toMatchObject({
      problem: { status: 404 },
    });
    expect(events).toHaveLength(0);
  });

  it('a valid sendToProjector still schedules and resolves normally', async () => {
    const { ops, seed } = build();
    const question = seed.questions.find((q) => q.state === 'sent')!;
    const accepted = await ops.sendToProjector(question.id);
    expect(accepted.commandId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('I4 — enableChannel/disableChannel validate the channel', () => {
  it('enableChannel("local") is refused — machine 1a owns it', async () => {
    const { ops } = build();
    await expect(ops.enableChannel('local')).rejects.toMatchObject({
      problem: { status: 422, code: 'config.invalid' },
    });
  });

  it('disableChannel("local") is refused', async () => {
    const { ops } = build();
    await expect(ops.disableChannel('local')).rejects.toMatchObject({
      problem: { status: 422, code: 'config.invalid' },
    });
  });

  it('an unknown channel id 404s instead of silently driving some other channel', async () => {
    const { ops } = build();
    await expect(ops.enableChannel('not-a-real-channel')).rejects.toMatchObject({
      problem: { status: 404 },
    });
    await expect(ops.disableChannel('not-a-real-channel')).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('enableChannel("meeting") while idle answers 409 session.not-active', async () => {
    const { world, ops } = build();
    expect(world.state('recording')).toBe('idle');
    await expect(ops.enableChannel('meeting')).rejects.toMatchObject({
      problem: { status: 409, code: 'session.not-active' },
    });
  });

  it('enableChannel("meeting") while recording is accepted', async () => {
    const { world, ops } = build();
    world.apply('R-01'); // idle -> starting, without waiting on the real R-05 timer
    world.apply('R-05'); // starting -> recording
    const accepted = await ops.enableChannel('meeting');
    expect(accepted.commandId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('I5 — responses go through validated() and never leak a live reference', () => {
  it('listPublications returns a schema-valid copy, not the seed array itself', async () => {
    const { ops, seed } = build();
    const pubs = await ops.listPublications({ sessionId: seed.questions[0]!.sessionId });
    expect(pubs).not.toBe(seed.publications);
    expect(pubs.length).toBe(seed.publications.length);
    pubs.push({ ...pubs[0]! }); // mutate the returned array
    expect(seed.publications.length).not.toBe(pubs.length); // seed is untouched
  });

  it('listPublicationResponses validates against the full envelope schema', async () => {
    const { ops, seed } = build();
    const body = await ops.listPublicationResponses(seed.publications[0]!.id);
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('syncedAt');
    expect(body).toHaveProperty('stale');
  });

  it('getEncoderSettings validates the whole { profile, capabilities } object', async () => {
    const { ops } = build();
    await loginAsAdmin(ops);
    const settings = await ops.getEncoderSettings();
    expect(settings.profile).toBeTruthy();
    expect(settings.capabilities).toBeTruthy();
    expect(settings.capabilities.videoBitrateKbps.min).toBeLessThan(settings.capabilities.videoBitrateKbps.max);
  });
});
