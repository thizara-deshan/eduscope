import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_RUNTIME_CONFIG,
  loadRuntimeConfig,
  type RuntimeConfig,
} from '@eduscope/api-client';

/**
 * `/config.json` is deploy-owned and is fetched + validated BEFORE the panel
 * constructs any client. A single built bundle changes adapter selection only
 * through this file — the app carries no `VITE_EDUSCOPE_REAL_API` branch.
 *
 * The provider renders nothing until the config resolves, so `ClientProvider`
 * (mounted as a child) always sees a validated config. A load failure in dev or
 * test falls back to the committed mock demo rather than white-screening; a real
 * deployment serves a valid `config.json` and never hits that path.
 */
const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

export function RuntimeConfigProvider({
  children,
  config,
  loader,
}: {
  children: ReactNode;
  /** Test/deploy injection — when set, skip the network load entirely. */
  config?: RuntimeConfig;
  loader?: () => Promise<RuntimeConfig>;
}) {
  const [resolved, setResolved] = useState<RuntimeConfig | null>(config ?? null);

  useEffect(() => {
    if (config) {
      setResolved(config);
      return;
    }
    let cancelled = false;
    const load = loader ?? (() => loadRuntimeConfig());
    void load().then(
      (loaded) => {
        if (!cancelled) setResolved(loaded);
      },
      (error: unknown) => {
        console.warn('runtime config load failed; using mock demo default', error);
        if (!cancelled) setResolved(DEFAULT_RUNTIME_CONFIG);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config, loader]);

  if (!resolved) return null;
  return (
    <RuntimeConfigContext.Provider value={resolved}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

/** Throws outside a provider — application code must have a resolved config. */
export function useRuntimeConfig(): RuntimeConfig {
  const config = useContext(RuntimeConfigContext);
  if (!config) {
    throw new Error('useRuntimeConfig must be used inside <RuntimeConfigProvider>');
  }
  return config;
}

/** Non-throwing read for `ClientProvider`, which defaults to the mock demo. */
export function useOptionalRuntimeConfig(): RuntimeConfig | null {
  return useContext(RuntimeConfigContext);
}
