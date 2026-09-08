'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_RUNTIME_CONFIG,
  loadRuntimeConfig,
  type RuntimeConfig,
} from '@eduscope/api-client';

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

export function RuntimeConfigProvider({
  children,
  config,
  loader,
}: {
  children: ReactNode;
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
      (loaded) => { if (!cancelled) setResolved(loaded); },
      (error: unknown) => {
        console.warn('runtime config load failed; using mock demo default', error);
        if (!cancelled) setResolved(DEFAULT_RUNTIME_CONFIG);
      },
    );
    return () => { cancelled = true; };
  }, [config, loader]);

  if (!resolved) return null;
  return <RuntimeConfigContext.Provider value={resolved}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig(): RuntimeConfig {
  const config = useContext(RuntimeConfigContext);
  if (!config) throw new Error('useRuntimeConfig must be used inside <RuntimeConfigProvider>');
  return config;
}

export function useOptionalRuntimeConfig(): RuntimeConfig | null {
  return useContext(RuntimeConfigContext);
}
