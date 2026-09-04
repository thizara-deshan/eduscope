export type { ChannelSnapshot, EduscopeClient, PreviewChannel } from './client.js';
export type { ConnectionStatus, EventStream, Unsubscribe } from './stream.js';
export { createEmitter } from './stream.js';
export { NotImplementedError, ProblemError, TransportError } from './errors.js';
export { createRealClient } from './real/create-real-client.js';
export { createMockClient } from './mock/create-mock-client.js';
export type { MockClient } from './mock/create-mock-client.js';
export {
  createScenarioEngine, extendScenario, getScenario, listScenarios,
} from './mock/scenario/registry.js';
export {
  ADAPTER_DOMAINS, PANEL_EVENT_DOMAIN, PANEL_OPERATION_DOMAIN,
} from './mixed/domains.js';
export type { AdapterDomain, AdapterKind } from './mixed/domains.js';
export {
  DEFAULT_RUNTIME_CONFIG, loadRuntimeConfig, resolveSelection, zRuntimeConfig,
} from './mixed/runtime-config.js';
export type { RuntimeConfig } from './mixed/runtime-config.js';
export { createRoutedClient } from './mixed/create-routed-client.js';
export type {
  DomainConnection, DomainSelection, RoutedClient,
} from './mixed/create-routed-client.js';
export type {
  ForcedTransition, ScenarioName, ScenarioScript, StudentQuizScenario,
  StudentQuizTransitionId, TimelineEntry, WorldSeed,
} from './mock/scenario/types.js';
