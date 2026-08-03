import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App.js';

/**
 * `ClientProvider` builds the mock through a dynamic `import()` (so the
 * simulation stays out of the entry chunk), and renders nothing until it
 * resolves. `render()` is synchronous, so the tree is empty for the first
 * microtask turn — flush the pending module load before asserting.
 */
async function renderApp(): Promise<void> {
  render(<App />);
  await act(async () => {
    await vi.dynamicImportSettled();
  });
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
