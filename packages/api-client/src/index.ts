export type { EduscopeClient, PreviewChannel } from './client.js';
export type { ConnectionStatus, EventStream, Unsubscribe } from './stream.js';
export { createEmitter } from './stream.js';
export { NotImplementedError, ProblemError } from './errors.js';
export { createRealClient } from './real/create-real-client.js';
