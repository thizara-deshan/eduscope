import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

/**
 * The panel now resolves deploy-owned `/config.json` (served by test-setup),
 * then `ClientProvider` builds the mock through a dynamic `import()` (so the
 * simulation stays out of the entry chunk) and renders nothing until it
 * resolves. Both are async, so wait for the mounted stage rather than flushing
 * a single import turn.
 */
async function renderApp(): Promise<void> {
  render(<App />);
  await waitFor(() => screen.getByTestId('us-panel'));
}

describe('panel shell', () => {
  it('renders the kiosk stage at the fixed panel size', async () => {
    await renderApp();
    const panel = screen.getByTestId('us-panel');
    expect(panel).toBeTruthy();
    expect(getComputedStyle(panel).maxWidth).toBe('1280px');
    expect(getComputedStyle(panel).maxHeight).toBe('800px');
  });

  it('makes the panel the positioning context for overlays', async () => {
    await renderApp();
    expect(getComputedStyle(screen.getByTestId('us-panel')).position).toBe('relative');
  });
});
