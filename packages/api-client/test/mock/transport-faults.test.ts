import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../src/mock/create-mock-client.js';
import { TransportError, ProblemError } from '../../src/errors.js';

describe('scenario transport faults (W1-D-1)', () => {
  it('fails the first login at the transport layer, then lets it through', async () => {
    const client = createMockClient('auth-failures');
    await expect(
      client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' }),
    ).rejects.toBeInstanceOf(TransportError);

    const ok = await client.login({
      username: 'a.perera', password: 'correct-horse', client: 'panel',
    });
    expect(ok.user.username).toBe('a.perera');
    client.dispose();
  });

  it('carries no Problem body — a transport failure is not a refusal', async () => {
    const client = createMockClient('auth-failures');
    const error = await client
      .login({ username: 'a.perera', password: 'correct-horse', client: 'panel' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    expect((error as { problem?: unknown }).problem).toBeUndefined();
    expect((error as TransportError).operation).toBe('login');
    client.dispose();
  });

  it('does not let onCommand consume an unreachable rule\'s nth', async () => {
    // The regression: match() consumes an occurrence the moment its predicate
    // passes. Before the predicate carried `replace`, onCommand (called INSIDE
    // login) burned the transport rule's only occurrence and the fault never
    // fired at all.
    const client = createMockClient('auth-failures');
    await expect(
      client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' }),
    ).rejects.toBeInstanceOf(TransportError);
    client.dispose();
  });

  it('refuses getProvisioning once with a takeover reason, then serves it', async () => {
    const client = createMockClient('auth-failures');
    const error = await client.getProvisioning().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemError);
    expect((error as ProblemError).problem).toMatchObject({
      status: 401, code: 'auth.session-revoked', meta: { reason: 'takeover' },
    });
    await expect(client.getProvisioning()).resolves.toHaveProperty('hallDisplayName');
    client.dispose();
  });

  it('keeps operation identity stable across property reads', () => {
    const client = createMockClient('happy');
    expect(client.login).toBe(client.login);
    client.dispose();
  });

  it('rebuilds the counters on switchScenario', async () => {
    const client = createMockClient('auth-failures');
    await client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' })
      .catch(() => undefined);
    client.switchScenario('auth-failures');
    await expect(
      client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' }),
    ).rejects.toBeInstanceOf(TransportError);
    client.dispose();
  });

  it('leaves happy with no transport faults at all', async () => {
    const client = createMockClient('happy');
    await expect(
      client.login({ username: 'a.perera', password: 'correct-horse', client: 'panel' }),
    ).resolves.toBeTruthy();
    client.dispose();
  });
});
