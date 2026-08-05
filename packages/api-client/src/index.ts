export type { EduscopeClient, PreviewChannel } from './client.js';
export type { ConnectionStatus, EventStream, Unsubscribe } from './stream.js';
export { createEmitter } from './stream.js';
export { NotImplementedError, ProblemError, TransportError } from './errors.js';
export { createRealClient } from './real/create-real-client.js';
export { createMockClient } from './mock/create-mock-client.js';
export type { MockClient } from './mock/create-mock-client.js';
export {
  createScenarioEngine, extendScenario, getScenario, listScenarios,
} from './mock/scenario/registry.js';
export type {
  ForcedTransition, ScenarioName, ScenarioScript, TimelineEntry, WorldSeed,
} from './mock/scenario/types.js';
