/**
 * The client-boundary rule (frontend-conventions §1):
 *
 *   "No component may import fetch, axios, or WebSocket directly. The ONLY
 *    network boundary is the EduscopeClient interface in packages/api-client."
 *
 * Composed from core ESLint rules rather than a custom rule because three
 * different mechanisms are needed: globals (fetch/WebSocket are not imports),
 * imports (axios and friends), and member access (window.fetch).
 */
const REASON =
  'Use the EduscopeClient from packages/api-client — it is the only network boundary (frontend-conventions §1).';

export const bannedGlobals = [
  { name: 'fetch', message: REASON },
  { name: 'WebSocket', message: REASON },
  { name: 'XMLHttpRequest', message: REASON },
  { name: 'EventSource', message: REASON },
  { name: 'RTCPeerConnection', message: `${REASON} Preview signaling lives behind client.openPreview().` },
];

export const bannedImports = [
  'axios', 'ky', 'got', 'superagent', 'socket.io-client', 'undici', 'node-fetch',
  'cross-fetch', 'isomorphic-fetch', 'wretch', 'redaxios',
].map((name) => ({ name, message: REASON }));

export const bannedProperties = [
  { object: 'window', property: 'fetch', message: REASON },
  { object: 'globalThis', property: 'fetch', message: REASON },
  { object: 'window', property: 'WebSocket', message: REASON },
  { object: 'navigator', property: 'sendBeacon', message: REASON },
];

/** Everything except the boundary package itself. */
export const boundaryFiles = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'];
export const boundaryExempt = ['packages/api-client/src/**'];
