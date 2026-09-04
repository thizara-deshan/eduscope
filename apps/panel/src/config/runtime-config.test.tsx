import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSelection, type RuntimeConfig } from '@eduscope/api-client';
import {
  RuntimeConfigProvider,
  useRuntimeConfig,
} from './runtime-config.js';

const mockConfig: RuntimeConfig = {
  apiBaseUrl: '/api/v1',
  quizBaseUrl: 'https://quiz.example.edu',
  environment: 'development',
  adapters: { default: 'mock', overrides: {} },
};

const mixedConfig: RuntimeConfig = {
  apiBaseUrl: '/api/v1',
  quizBaseUrl: 'https://quiz.example.edu',
  environment: 'integration',
  adapters: { default: 'mock', overrides: { recording: 'real' } },
};

function Probe() {
  const config = useRuntimeConfig();
  const selection = resolveSelection(config);
  return <div data-testid="probe">{`${config.environment}:${selection.recording}`}</div>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RuntimeConfigProvider', () => {
  it('provides an injected config synchronously', () => {
    render(
      <RuntimeConfigProvider config={mockConfig}>
        <Probe />
      </RuntimeConfigProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('development:mock');
  });

  it('selects adapters at runtime — the same bundle serves opposite JSON with no rebuild', () => {
    const first = render(
      <RuntimeConfigProvider config={mockConfig}>
        <Probe />
      </RuntimeConfigProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('development:mock');
    first.unmount();

    render(
      <RuntimeConfigProvider config={mixedConfig}>
        <Probe />
      </RuntimeConfigProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('integration:real');
  });

  it('renders nothing until an async load resolves, then provides it', async () => {
    let resolveLoad: (c: RuntimeConfig) => void = () => {};
    const loader = () => new Promise<RuntimeConfig>((r) => (resolveLoad = r));
    render(
      <RuntimeConfigProvider loader={loader}>
        <Probe />
      </RuntimeConfigProvider>,
    );
    expect(screen.queryByTestId('probe')).toBeNull();
    await act(async () => {
      resolveLoad(mixedConfig);
    });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('integration:real'));
  });

  it('falls back to the mock demo default when the load fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = () => Promise.reject(new Error('no config.json'));
    render(
      <RuntimeConfigProvider loader={loader}>
        <Probe />
      </RuntimeConfigProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('development:mock'));
  });
});
