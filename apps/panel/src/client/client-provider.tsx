import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createRealClient,
  createRoutedClient,
  DEFAULT_RUNTIME_CONFIG,
  resolveSelection,
} from '@eduscope/api-client';
import type {
  AdapterDomain,
  EduscopeClient,
  MockClient,
  RoutedClient,
  RuntimeConfig,
  ScenarioName,
} from '@eduscope/api-client';
import { useWsStore } from '../store/ws-store.js';
import { useOptionalRuntimeConfig } from '../config/runtime-config.js';

/**
 * Exported ONLY for tests that need a synchronous stub client (`use-login`,
 * `use-change-password`, …) — `ClientProvider` itself always constructs its
 * client asynchronously (the comment below explains why), which is unusable
 * with fake timers. Application code must go through `useClient()`.
 */
export const ClientContext = createContext<EduscopeClient | null>(null);

/**
 * The concrete mock, exposed separately so the dev overlay can reach
 * `switchScenario` even though `useClient()` hands out the routed client (which
 * is `EduscopeClient`-shaped and has no mock surface). Null when no domain
 * selects mock — which is exactly when the overlay must stay hidden.
 */
const MockClientContext = createContext<MockClient | null>(null);

/**
 * THE only place in apps/panel that constructs a client. Everything else takes
 * it from context, which is what makes the ESLint boundary rule enforceable:
 * there is no second path to the network. Adapter selection is now RUNTIME, per
 * domain, driven by the validated `RuntimeConfig` — no `import.meta.env`.
 */
export function ClientProvider({
  children,
  scenario = 'happy',
  config: configProp,
}: {
  children: ReactNode;
  scenario?: ScenarioName;
  config?: RuntimeConfig;
}) {
  const contextConfig = useOptionalRuntimeConfig();
  const config = configProp ?? contextConfig ?? DEFAULT_RUNTIME_CONFIG;
  const selection = useMemo(() => resolveSelection(config), [config]);

  const [client, setClient] = useState<RoutedClient | null>(null);
  const [mockClient, setMockClient] = useState<MockClient | null>(null);

  /**
   * The client is constructed INSIDE the effect, not in useMemo.
   *
   * `createMockClient` starts wall-clock timers the moment it is called (the
   * 10 Hz level loop, the ws-flap schedule). Under StrictMode React renders
   * twice and throws the first render away — a useMemo'd client from that
   * discarded render never reaches an effect, so nothing ever calls dispose()
   * and it emits forever. Constructing here means every client that exists has
   * a matching cleanup.
   */
  useEffect(() => {
    const anyMock = Object.values(selection).some((kind) => kind === 'mock');

    // Cleanup can run before the import resolves (StrictMode's discarded first
    // render, or a fast scenario switch). Every client that gets constructed
    // must still get a matching dispose(), so the late arrival checks this flag
    // rather than assuming it is still wanted.
    let cancelled = false;
    let instance: RoutedClient | null = null;
    const offs: Array<() => void> = [];

    /**
     * The mock adapter is imported DYNAMICALLY, and only when a domain actually
     * selects it — a fully real deployment never requests its chunk. The real
     * client is a lightweight constructor and is always built once.
     */
    const build = async (): Promise<{ routed: RoutedClient; mock: MockClient | null }> => {
      const real = createRealClient(config.apiBaseUrl);
      const mock = anyMock
        ? (await import('@eduscope/api-client/mock')).createMockClient(scenario)
        : null;
      const routed = createRoutedClient({ mock, real, selection });
      return { routed, mock };
    };

    void build().then(({ routed, mock }) => {
      if (cancelled) {
        routed.dispose();
        return;
      }
      instance = routed;
      offs.push(
        routed.events$.subscribe((e) => {
          useWsStore.getState().ingest(e);
        }),
      );
      offs.push(
        routed.connection$.subscribe((s) => {
          useWsStore.getState().setConnection(s);
        }),
      );

      // A `seq` gap surfaces as a `resyncReason` on the PER-DOMAIN connection
      // stream, so only the affected domains are reset. A burst of per-domain
      // signals from one socket is coalesced into a SINGLE reset + resync — the
      // resync re-subscribes for a full snapshot and never replays a command
      // (E-03, replacing the old global clearResync() timing race).
      const resyncDomains = new Set<AdapterDomain>();
      let scheduled = false;
      offs.push(
        routed.connectionByDomain$.subscribe((dc) => {
          if (!dc.resyncReason) return;
          resyncDomains.add(dc.domain);
          if (scheduled) return;
          scheduled = true;
          queueMicrotask(() => {
            const domains = [...resyncDomains];
            resyncDomains.clear();
            scheduled = false;
            useWsStore.getState().resetDomains(domains);
            void routed.resync();
          });
        }),
      );
      setMockClient(mock);
      setClient(routed);
    });

    return () => {
      cancelled = true;
      for (const off of offs) off();
      useWsStore.getState().reset();
      instance?.dispose();
      setClient(null);
      setMockClient(null);
    };
  }, [scenario, selection, config]);

  // One frame with no client while the effect runs. The kiosk boots into U-1's
  // skeleton anyway, so there is nothing to show yet.
  if (!client) return null;

  return (
    <ClientContext.Provider value={client}>
      <MockClientContext.Provider value={mockClient}>{children}</MockClientContext.Provider>
    </ClientContext.Provider>
  );
}

export function useClient(): EduscopeClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useClient must be used inside <ClientProvider>');
  return client;
}

/**
 * Dev overlay only — the concrete mock behind the routed client. Null against a
 * real-only client, so the overlay cannot cast its way to a `MockClient`.
 */
export function useMockClient(): MockClient | null {
  return useContext(MockClientContext);
}
