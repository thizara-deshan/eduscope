import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { OverlayHost, OverlayProvider, useOverlays } from './overlay-host.js';

function Harness() {
  const { open, close, stack } = useOverlays();
  return (
    <>
      <button type="button" onClick={() => open(<p>first</p>)}>open first</button>
      <button type="button" onClick={() => open(<p>second</p>)}>open second</button>
      <button type="button" onClick={() => open(<p>locked</p>, { dismissible: false })}>
        open locked
      </button>
      <button type="button" onClick={() => stack[0] && close(stack[0].id)}>
        close first
      </button>
      <OverlayHost />
    </>
  );
}

const renderHost = () =>
  render(
    <OverlayProvider>
      <Harness />
    </OverlayProvider>,
  );

describe('overlay host', () => {
  it('renders nothing until an overlay is opened', () => {
    renderHost();
    expect(screen.getByTestId('overlay-host').dataset.depth).toBe('0');
  });

  it('stacks overlays — S-15 opens on top of S-14, it does not replace it', async () => {
    const user = userEvent.setup();
    renderHost();
    await user.click(screen.getByRole('button', { name: 'open first' }));
    await user.click(screen.getByRole('button', { name: 'open second' }));
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.getByTestId('overlay-host').dataset.depth).toBe('2');
  });

  it('orders layers so the newest is on top', async () => {
    const user = userEvent.setup();
    renderHost();
    await user.click(screen.getByRole('button', { name: 'open first' }));
    await user.click(screen.getByRole('button', { name: 'open second' }));
    const layers = screen.getByTestId('overlay-host').querySelectorAll('.us-overlayhost__layer');
    const z = [...layers].map((l) => Number((l as HTMLElement).style.zIndex));
    expect(z[1]!).toBeGreaterThan(z[0]!);
  });

  it('closes a specific overlay without disturbing the rest', async () => {
    const user = userEvent.setup();
    renderHost();
    await user.click(screen.getByRole('button', { name: 'open first' }));
    await user.click(screen.getByRole('button', { name: 'open second' }));
    await user.click(screen.getByRole('button', { name: 'close first' }));
    expect(screen.queryByText('first')).toBeNull();
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('leaves a non-dismissible overlay alone on Escape (S-02 has no escape hatch)', async () => {
    const user = userEvent.setup();
    renderHost();
    await user.click(screen.getByRole('button', { name: 'open locked' }));
    // .us-overlayhost is deliberately pointer-events: none (only its layers are
    // interactive), so user-event's pointer-eligibility check refuses
    // user.type() here — fireEvent dispatches the key event directly instead.
    fireEvent.keyDown(screen.getByTestId('overlay-host'), { key: 'Escape' });
    expect(screen.getByText('locked')).toBeTruthy();
  });

  it('mounts inside .us-panel — never position: fixed (conventions §3)', () => {
    renderHost();
    expect(getComputedStyle(screen.getByTestId('overlay-host')).position).toBe('absolute');
  });
});
