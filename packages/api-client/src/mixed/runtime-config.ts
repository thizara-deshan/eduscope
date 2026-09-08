/**
 * Deploy-owned runtime configuration (Workstream E, master-plan §"Runtime
 * selection"). `/config.json` is fetched and validated BEFORE either app
 * constructs a client, so a single built bundle changes adapter selection only
 * through this file — never through a Vite/Next build-time flag.
 *
 * Production is accepted only as `{default:"real",overrides:{}}`: overrides are
 * a development affordance and are rejected outright in production.
 */
import { z } from 'zod';
import {
  ADAPTER_DOMAINS,
  type AdapterDomain,
  type AdapterKind,
} from './domains.js';

export const zRuntimeConfig = z
  .object({
    apiBaseUrl: z.string().min(1),
    quizBaseUrl: z.string().url(),
    environment: z.enum(['development', 'integration', 'production']),
    adapters: z
      .object({
        default: z.enum(['mock', 'real']),
        overrides: z.record(z.enum(ADAPTER_DOMAINS), z.enum(['mock', 'real'])),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.environment === 'production' &&
      Object.keys(value.adapters.overrides).length > 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['adapters', 'overrides'],
        message: 'production overrides are forbidden',
      });
    }
  });

export type RuntimeConfig = z.infer<typeof zRuntimeConfig>;

/** The committed demo configuration — mock everywhere, development. */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  apiBaseUrl: '/api/v1',
  quizBaseUrl: 'https://quiz.example.edu',
  environment: 'development',
  adapters: { default: 'mock', overrides: {} },
};

type FetchLike = (
  input: string,
  init?: { cache?: string; credentials?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Fetch and validate `/config.json` exactly once. Requires a 200 JSON body and
 * a schema-valid document; any deviation throws rather than silently falling
 * back — the caller decides whether a failure is fatal or dev-defaultable.
 */
export async function loadRuntimeConfig(
  options: { fetch?: FetchLike; url?: string } = {},
): Promise<RuntimeConfig> {
  const fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (!fetchImpl) throw new Error('loadRuntimeConfig: no fetch available');
  const url = options.url ?? '/config.json';
  const response = await fetchImpl(url, {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok || response.status !== 200) {
    throw new Error(`loadRuntimeConfig: ${url} returned ${response.status}`);
  }
  const body = await response.json();
  return zRuntimeConfig.parse(body);
}

/** Resolve the per-domain adapter kind: an override wins, else the default. */
export function resolveSelection(
  config: RuntimeConfig,
): Record<AdapterDomain, AdapterKind> {
  const selection = {} as Record<AdapterDomain, AdapterKind>;
  for (const domain of ADAPTER_DOMAINS) {
    selection[domain] = config.adapters.overrides[domain] ?? config.adapters.default;
  }
  return selection;
}
