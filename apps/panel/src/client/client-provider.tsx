import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createRealClient } from '@eduscope/api-client';
import type { EduscopeClient, MockClient, ScenarioName } from '@eduscope/api-client';
import { useWsStore } from '../store/ws-store.js';

const ClientContext = createContext<EduscopeClient | null>(null);

/**
 * THE only place in apps/panel that constructs a client. Everything else takes
 * it from context, which is what makes the ESLint boundary rule enforceable:
 * there is no second path to the network.
 */
export function ClientProvider({
  children,
  scenario = 'happy',
}: {
  children: ReactNode;
  scenario?: ScenarioName;
}) {
  const [client, setClient] = useState<EduscopeClient | null>(null);

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
    /**
     * The mock adapter is imported DYNAMICALLY.
     *
     * It is a discrete-event simulation of every state machine plus all 77 REST
     * operations — statically imported it lands in the entry chunk and is parsed
     * on a 1280x800 kiosk that will never execute a line of it. A dynamic import
     * gives it its own chunk that a real-API build never requests.
     */
    const load = async (): Promise<EduscopeClient> =>
      import.meta.env.VITE_EDUSCOPE_REAL_API === '1'
        ? createRealClient(import.meta.env.VITE_EDUSCOPE_API_URL ?? '/api/v1')
        : (await import('@eduscope/api-client/mock')).createMockClient(scenario);

    // Cleanup can run before the import resolves (StrictMode's discarded first
    // render, or a fast scenario switch). Every client that gets constructed
    // must still get a matching dispose(), so the late arrival checks this flag
    // rather than assuming it is still wanted.
    let cancelled = false;
    let instance: EduscopeClient | null = null;
    const offs: Array<() => void> = [];

    void load().then((created) => {
      if (cancelled) {
        created.dispose();
        return;
      }
      instance = created;
      offs.push(
        created.events$.subscribe((e) => {
          useWsStore.getState().ingest(e);
        }),
      );
      offs.push(
        created.connection$.subscribe((s) => {
          useWsStore.getState().setConnection(s);
          if (s.resyncReason) {
            void created.resync().then(() => useWsStore.getState().clearResync());
          }
        }),
      );
      setClient(created);
    });

    return () => {
      cancelled = true;
      for (const off of offs) off();
      useWsStore.getState().reset();
      instance?.dispose();
      setClient(null);
    };
  }, [scenario]);

  // One frame with no client while the effect runs. The kiosk boots into U-1's
  // skeleton anyway, so there is nothing to show yet.
  if (!client) return null;

  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): EduscopeClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useClient must be used inside <ClientProvider>');
  return client;
}

/** Dev overlay only — narrows to the concrete mock. Returns null against real. */
export function useMockClient(): MockClient | null {
  const client = useClient() as Partial<MockClient>;
  return typeof client.switchScenario === 'function' ? (client as MockClient) : null;
}
