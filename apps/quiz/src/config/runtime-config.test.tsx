import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RUNTIME_CONFIG,
  type RuntimeConfig,
} from '@eduscope/api-client';
import { RuntimeConfigProvider, useRuntimeConfig } from './runtime-config.js';

function Probe() {
  const config = useRuntimeConfig();
  return <span>{`${config.environment}:${config.adapters.default}`}</span>;
}

describe('quiz RuntimeConfigProvider', () => {
  it('waits for a validated runtime load before mounting children', async () => {
    let resolve!: (config: RuntimeConfig) => void;
    const loader = vi.fn(() => new Promise<RuntimeConfig>((done) => { resolve = done; }));
    render(<RuntimeConfigProvider loader={loader}><Probe /></RuntimeConfigProvider>);
    expect(screen.queryByText('development:mock')).toBeNull();
    resolve(DEFAULT_RUNTIME_CONFIG);
    await waitFor(() => expect(screen.getByText('development:mock')).toBeInTheDocument());
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('accepts a real studentQuiz override independently of other domains', () => {
    render(
      <RuntimeConfigProvider config={{
        ...DEFAULT_RUNTIME_CONFIG,
        environment: 'integration',
        adapters: { default: 'mock', overrides: { studentQuiz: 'real' } },
      }}>
        <Probe />
      </RuntimeConfigProvider>,
    );
    expect(screen.getByText('integration:mock')).toBeInTheDocument();
  });
});
