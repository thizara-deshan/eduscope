/**
 * The mixed adapter. One panel owns one mock and one real `EduscopeClient`;
 * this router chooses, per call, which one serves each operation, filters each
 * adapter's event stream down to the domains that adapter actually owns, and
 * projects one connection status per selected domain.
 *
 * Every operation is a closure that resolves its target at CALL TIME, so the
 * same routed client keeps working if selection is recomputed (E-03 rewires the
 * real socket status here; E-01 establishes the plumbing).
 */
import {
  PANEL_OPERATION_IDS,
  type EventEnvelope,
  type PanelEventName,
  type SourceRoleId,
} from '@eduscope/shared';
import type { EduscopeClient, PreviewChannel } from '../client.js';
import {
  createEmitter,
  type ConnectionStatus,
  type EventStream,
  type Unsubscribe,
} from '../stream.js';
import {
  ADAPTER_DOMAINS,
  PANEL_EVENT_DOMAIN,
  PANEL_OPERATION_DOMAIN,
  type AdapterDomain,
  type AdapterKind,
} from './domains.js';

export type DomainSelection = Record<AdapterDomain, AdapterKind>;

/** A connection status tagged with the domain it applies to. */
export interface DomainConnection extends ConnectionStatus {
  readonly domain: AdapterDomain;
  readonly kind: AdapterKind;
}

/** The routed surface: an `EduscopeClient` plus the per-domain connection map. */
export interface RoutedClient extends EduscopeClient {
  readonly connectionByDomain$: EventStream<DomainConnection>;
  readonly selection: DomainSelection;
}

export function createRoutedClient(args: {
  mock?: EduscopeClient | null;
  real: EduscopeClient;
  selection: DomainSelection;
}): RoutedClient {
  const { mock, real, selection } = args;

  const domainsFor = (kind: AdapterKind): Set<AdapterDomain> =>
    new Set(ADAPTER_DOMAINS.filter((d) => selection[d] === kind));
  const mockDomains = domainsFor('mock');
  const realDomains = domainsFor('real');

  if (mockDomains.size > 0 && !mock) {
    throw new Error(
      'createRoutedClient: a domain selects mock but no mock client was provided',
    );
  }

  const clientFor = (domain: AdapterDomain): EduscopeClient => {
    if (selection[domain] === 'mock') {
      if (!mock) throw new Error(`createRoutedClient: mock domain ${domain} has no mock client`);
      return mock;
    }
    return real;
  };

  const events = createEmitter<EventEnvelope>();
  const connection = createEmitter<ConnectionStatus>();
  const connectionByDomain = createEmitter<DomainConnection>();
  const subscriptions: Unsubscribe[] = [];

  const wire = (
    client: EduscopeClient,
    kind: AdapterKind,
    ownedDomains: Set<AdapterDomain>,
  ): void => {
    subscriptions.push(
      client.events$.subscribe((envelope) => {
        const domain = PANEL_EVENT_DOMAIN[envelope.event as PanelEventName];
        // Only forward an event whose owning domain is selected to THIS
        // adapter; an inactive adapter's events are discarded, never merged.
        if (domain && selection[domain] === kind) events.emit(envelope);
      }),
    );
    subscriptions.push(
      client.connection$.subscribe((status) => {
        connection.emit(status);
        for (const domain of ownedDomains) {
          connectionByDomain.emit({ ...status, domain, kind });
        }
      }),
    );
  };

  // Subscribe once to each adapter that owns at least one selected domain. A
  // fully mock deployment never touches the (still-dead, pre-E-03) real streams.
  if (mock && mockDomains.size > 0) wire(mock, 'mock', mockDomains);
  if (realDomains.size > 0) wire(real, 'real', realDomains);

  const routed: Record<string, unknown> = {};
  for (const id of PANEL_OPERATION_IDS) {
    const domain = PANEL_OPERATION_DOMAIN[id];
    routed[id] = (...callArgs: unknown[]) => {
      const target = clientFor(domain) as unknown as Record<
        string,
        (...a: unknown[]) => unknown
      >;
      return target[id]!(...callArgs);
    };
  }

  routed.events$ = events;
  routed.connection$ = connection;
  routed.connectionByDomain$ = connectionByDomain;
  routed.selection = selection;

  // Preview is its own channel and is never merged into panel events.
  routed.openPreview = (roleId: SourceRoleId): PreviewChannel =>
    clientFor('preview').openPreview(roleId);

  routed.resync = async (): Promise<void> => {
    const targets = new Set<EduscopeClient>();
    if (mock && mockDomains.size > 0) targets.add(mock);
    if (realDomains.size > 0) targets.add(real);
    await Promise.all([...targets].map((client) => client.resync()));
  };

  let disposed = false;
  routed.dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const off of subscriptions) off();
    mock?.dispose();
    real.dispose();
  };

  return routed as unknown as RoutedClient;
}
