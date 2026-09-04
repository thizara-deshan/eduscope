import { describe, expect, it, vi } from 'vitest';
import type { EventEnvelope } from '@eduscope/shared';
import type { EduscopeClient } from '../../src/client.js';
import { createEmitter, type ConnectionStatus } from '../../src/stream.js';
import {
  ADAPTER_DOMAINS,
  type AdapterKind,
} from '../../src/mixed/domains.js';
import {
  createRoutedClient,
  type DomainConnection,
  type DomainSelection,
} from '../../src/mixed/create-routed-client.js';
import {
  DEFAULT_RUNTIME_CONFIG,
  loadRuntimeConfig,
  resolveSelection,
  zRuntimeConfig,
} from '../../src/mixed/runtime-config.js';

function makeFake(kind: AdapterKind) {
  const events = createEmitter<EventEnvelope>();
  const connection = createEmitter<ConnectionStatus>();
  const dispose = vi.fn();
  const resync = vi.fn(async () => {});
  const openPreview = vi.fn(() => ({ tag: `${kind}-preview` }) as never);
  const client = {
    events$: events,
    connection$: connection,
    dispose,
    resync,
    openPreview,
  } as unknown as EduscopeClient;
  // Every operation returns a tag identifying which adapter served it.
  return new Proxy(
    { client, events, connection, dispose, resync, openPreview },
    {},
  ) as {
    client: EduscopeClient;
    events: typeof events;
    connection: typeof connection;
    dispose: typeof dispose;
    resync: typeof resync;
    openPreview: typeof openPreview;
  };
}

/** Build a fake whose every operation is a spy returning `${kind}:${id}`. */
function fakeClient(kind: AdapterKind) {
  const fake = makeFake(kind);
  const record = fake.client as unknown as Record<string, unknown>;
  const calls: string[] = [];
  return {
    ...fake,
    calls,
    withOp(id: string) {
      record[id] = (...a: unknown[]) => {
        calls.push(id);
        return `${kind}:${id}(${a.join(',')})`;
      };
      return record[id];
    },
  };
}

const envelope = (event: string): EventEnvelope =>
  ({ event, seq: 1, at: '2026-09-04T00:00:00.000+00:00' }) as unknown as EventEnvelope;

const selectAll = (kind: AdapterKind): DomainSelection => {
  const s = {} as DomainSelection;
  for (const d of ADAPTER_DOMAINS) s[d] = kind;
  return s;
};

describe('runtime config schema', () => {
  it('accepts the committed demo config', () => {
    expect(zRuntimeConfig.parse(DEFAULT_RUNTIME_CONFIG)).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('rejects an invalid quiz URL', () => {
    expect(
      zRuntimeConfig.safeParse({ ...DEFAULT_RUNTIME_CONFIG, quizBaseUrl: 'not a url' }).success,
    ).toBe(false);
  });

  it('rejects an empty apiBaseUrl', () => {
    expect(
      zRuntimeConfig.safeParse({ ...DEFAULT_RUNTIME_CONFIG, apiBaseUrl: '' }).success,
    ).toBe(false);
  });

  it('rejects an unknown default adapter', () => {
    expect(
      zRuntimeConfig.safeParse({
        ...DEFAULT_RUNTIME_CONFIG,
        adapters: { default: 'fake', overrides: {} },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown override domain', () => {
    expect(
      zRuntimeConfig.safeParse({
        ...DEFAULT_RUNTIME_CONFIG,
        adapters: { default: 'mock', overrides: { notADomain: 'real' } },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown top-level keys', () => {
    expect(
      zRuntimeConfig.safeParse({ ...DEFAULT_RUNTIME_CONFIG, extra: true }).success,
    ).toBe(false);
  });

  it('rejects any override in production', () => {
    expect(
      zRuntimeConfig.safeParse({
        apiBaseUrl: '/api/v1',
        quizBaseUrl: 'https://quiz.example.edu',
        environment: 'production',
        adapters: { default: 'real', overrides: { auth: 'real' } },
      }).success,
    ).toBe(false);
  });

  it('accepts production with no overrides', () => {
    expect(
      zRuntimeConfig.safeParse({
        apiBaseUrl: '/api/v1',
        quizBaseUrl: 'https://quiz.example.edu',
        environment: 'production',
        adapters: { default: 'real', overrides: {} },
      }).success,
    ).toBe(true);
  });
});

describe('loadRuntimeConfig', () => {
  it('fetches once with no-store/same-origin and parses', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => DEFAULT_RUNTIME_CONFIG,
    }));
    const config = await loadRuntimeConfig({ fetch: fetchImpl as never });
    expect(config).toEqual(DEFAULT_RUNTIME_CONFIG);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/config.json', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('throws on a non-200 response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await expect(loadRuntimeConfig({ fetch: fetchImpl as never })).rejects.toThrow();
  });
});

describe('resolveSelection', () => {
  it('applies overrides over the default', () => {
    const selection = resolveSelection({
      apiBaseUrl: '/api/v1',
      quizBaseUrl: 'https://quiz.example.edu',
      environment: 'integration',
      adapters: { default: 'mock', overrides: { recording: 'real', alerts: 'real' } },
    });
    expect(selection.recording).toBe('real');
    expect(selection.alerts).toBe('real');
    expect(selection.channels).toBe('mock');
  });
});

describe('createRoutedClient routing', () => {
  it('routes opposite overrides to opposite spies at call time', () => {
    const mock = fakeClient('mock');
    const real = fakeClient('real');
    mock.withOp('listChannels');
    real.withOp('startRecording');
    const selection = selectAll('mock');
    selection.recording = 'real';

    const routed = createRoutedClient({ mock: mock.client, real: real.client, selection });
    const r = routed as unknown as Record<string, () => unknown>;

    expect(r.startRecording!()).toBe('real:startRecording()');
    expect(r.listChannels!()).toBe('mock:listChannels()');
    expect(real.calls).toEqual(['startRecording']);
    expect(mock.calls).toEqual(['listChannels']);
  });

  it('discards an event whose domain is not selected to the emitting adapter', () => {
    const mock = fakeClient('mock');
    const real = fakeClient('real');
    const selection = selectAll('mock');
    selection.recording = 'real'; // recording.* served by real

    const routed = createRoutedClient({ mock: mock.client, real: real.client, selection });
    const seen: string[] = [];
    const off = routed.events$.subscribe((e) => seen.push(e.event));

    real.events.emit(envelope('recording.state')); // real owns recording → forwarded
    mock.events.emit(envelope('recording.state')); // mock does NOT own recording → dropped
    real.events.emit(envelope('channel.state')); // real does NOT own channels → dropped
    mock.events.emit(envelope('channel.state')); // mock owns channels → forwarded

    off();
    routed.dispose();
    expect(seen).toEqual(['recording.state', 'channel.state']);
  });

  it('projects connection status only onto that adapter\'s selected domains', () => {
    const mock = fakeClient('mock');
    const real = fakeClient('real');
    const selection = selectAll('mock');
    selection.recording = 'real';
    selection.alerts = 'real';

    const routed = createRoutedClient({ mock: mock.client, real: real.client, selection });
    const projected: DomainConnection[] = [];
    const off = routed.connectionByDomain$.subscribe((c) => projected.push(c));

    real.connection.emit({ phase: 'open', attempt: 0, since: 'now' });
    const realDomains = projected.map((p) => p.domain).sort();
    expect(realDomains).toEqual(['alerts', 'recording']);
    expect(projected.every((p) => p.kind === 'real')).toBe(true);

    off();
    routed.dispose();
  });

  it('projects a real seq-gap resync onto only the real-selected domains', () => {
    const mock = fakeClient('mock');
    const real = fakeClient('real');
    const selection = selectAll('mock');
    selection.recording = 'real';
    selection.alerts = 'real';

    const routed = createRoutedClient({ mock: mock.client, real: real.client, selection });
    const gapped: DomainConnection[] = [];
    const off = routed.connectionByDomain$.subscribe((c) => {
      if (c.resyncReason) gapped.push(c);
    });

    real.connection.emit({ phase: 'reconnecting', attempt: 1, since: 'now', resyncReason: 'seq-gap' });
    expect(gapped.map((g) => g.domain).sort()).toEqual(['alerts', 'recording']);
    expect(gapped.every((g) => g.resyncReason === 'seq-gap' && g.kind === 'real')).toBe(true);

    off();
    routed.dispose();
  });

  it('disposes and unsubscribes both underlying clients exactly once', () => {
    const mock = fakeClient('mock');
    const real = fakeClient('real');
    const selection = selectAll('mock');
    selection.recording = 'real';

    const routed = createRoutedClient({ mock: mock.client, real: real.client, selection });
    const seen: string[] = [];
    routed.events$.subscribe((e) => seen.push(e.event));

    routed.dispose();
    routed.dispose(); // idempotent

    expect(mock.dispose).toHaveBeenCalledTimes(1);
    expect(real.dispose).toHaveBeenCalledTimes(1);

    // After dispose the internal subscriptions are gone: further emits are dead.
    real.events.emit(envelope('recording.state'));
    expect(seen).toEqual([]);
  });

  it('routes the preview channel through the preview domain', () => {
    const mock = fakeClient('mock');
    const real = fakeClient('real');
    const selection = selectAll('mock');
    selection.preview = 'real';

    const routed = createRoutedClient({ mock: mock.client, real: real.client, selection });
    routed.openPreview('presentation');
    expect(real.openPreview).toHaveBeenCalledWith('presentation');
    expect(mock.openPreview).not.toHaveBeenCalled();
    routed.dispose();
  });
});
