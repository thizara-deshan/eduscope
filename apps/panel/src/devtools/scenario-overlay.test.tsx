import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientProvider } from '../client/client-provider.js';
// scenario-overlay.css reads --tap-min from tokens.css, the app's root design-
// token sheet (loaded once by App.tsx in production). This test renders the
// overlay in isolation, so it must load tokens itself to get real computed
// values rather than empty strings for every var(--x) reference.
import '../styles/tokens.css';
import { ScenarioOverlay } from './scenario-overlay.js';

/**
 * `ClientProvider` builds the mock through a dynamic `import()` (so the
 * simulation stays out of the entry chunk), and renders nothing until it
 * resolves. `render()` is synchronous, so the overlay is absent for the first
 * microtask turn — flush the pending module load before asserting. Fake timers
 * do not gate microtasks, so this settles without advancing the clock.
 */
async function renderOverlay(): Promise<void> {
  render(
    <ClientProvider>
      <ScenarioOverlay />
    </ClientProvider>,
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

// @testing-library/user-event's async pointer/click sequencing hangs
// indefinitely under vi.useFakeTimers() in this dependency combination
// (user-event 14.6.1 + vitest 3.2.7) — reproduced even for a bare
// user.click() with delay:null, independent of jsdom vs. happy-dom and of
// createMockClient/ClientProvider being involved at all. fireEvent dispatches
// the DOM event directly with no internal async wait, so it isn't affected.
describe('scenario dev overlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is hidden until the long-press completes', async () => {
    await renderOverlay();
    expect(screen.queryByRole('dialog', { name: /scenario/i })).toBeNull();

    fireEvent.pointerDown(screen.getByTestId('scenario-hotspot'));
    act(() => {
      vi.advanceTimersByTime(1_900);
    });
    expect(screen.queryByRole('dialog', { name: /scenario/i })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('dialog', { name: /scenario/i })).toBeTruthy();
  });

  it('lists all seven catalog scripts with their descriptions', async () => {
    await renderOverlay();
    fireEvent.pointerDown(screen.getByTestId('scenario-hotspot'));
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    for (const name of [
      'happy', 'start-fails', 'pipeline-crash-midway', 'llm-timeout',
      'disk-full', 'ws-flap', 'quiz-network-loss',
    ]) {
      expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it('switches the live scenario when a script is chosen', async () => {
    await renderOverlay();
    fireEvent.pointerDown(screen.getByTestId('scenario-hotspot'));
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    fireEvent.click(screen.getByRole('radio', { name: /start-fails/ }));
    expect(screen.getByRole('radio', { name: /start-fails/ })).toBeChecked();
    expect(screen.getByTestId('active-scenario')).toHaveTextContent('start-fails');
  });

  it('meets the 44px touch floor on the hotspot and every option', async () => {
    await renderOverlay();
    const hotspot = screen.getByTestId('scenario-hotspot');
    expect(getComputedStyle(hotspot).minWidth).toBe('44px');
    expect(getComputedStyle(hotspot).minHeight).toBe('44px');

    fireEvent.pointerDown(hotspot);
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    for (const option of screen.getAllByRole('radio')) {
      expect(getComputedStyle(option.closest('label')!).minHeight).toBe('56px');
    }
  });
});
