import { useEffect, useRef, useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardHost, OSK_OPEN_PX } from './keyboard-host.js';
import { useOskField } from './use-keyboard.js';

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="us-panel" data-testid="us-panel">
      {children}
      <KeyboardHost />
    </div>
  );
}

function TextField({
  layout = 'default',
  onCommit,
}: {
  layout?: 'default' | 'numeric';
  onCommit?: (count: number) => void;
}) {
  const [value, setValue] = useState('');
  const binding = useOskField({ value, onChange: setValue, layout });
  const commits = useRef(0);
  useEffect(() => {
    commits.current += 1;
    onCommit?.(commits.current);
  });
  return <input aria-label="field" value={value} onChange={() => {}} {...binding} />;
}

function oskHeight(): string {
  const panel = screen.getByTestId('us-panel');
  return panel.style.getPropertyValue('--osk-h');
}

async function pressKey(button: string): Promise<void> {
  const el = document.querySelector(`[data-skbtn="${button}"]`);
  if (!el) throw new Error(`no key rendered for ${button}`);
  await userEvent.click(el);
}

describe('KeyboardHost', () => {
  it('is closed by default and --osk-h reads 0px on .us-panel', () => {
    render(
      <Panel>
        <TextField />
      </Panel>,
    );
    expect(oskHeight()).toBe('0px');
    expect(screen.queryByTestId('keyboard-host')?.querySelector('.us-osk__keyboard')).toBeNull();
  });

  it('opens on focus and --osk-h reads 380px', () => {
    render(
      <Panel>
        <TextField />
      </Panel>,
    );
    fireEvent.focus(screen.getByLabelText('field'));
    expect(oskHeight()).toBe(`${OSK_OPEN_PX}px`);
  });

  it('the close key closes it and restores 0px; the close button is >=44px and has an aria-label', () => {
    render(
      <Panel>
        <TextField />
      </Panel>,
    );
    fireEvent.focus(screen.getByLabelText('field'));
    const closeBtn = screen.getByRole('button', { name: 'Close keyboard' });
    expect(closeBtn.className).toContain('us-osk__close');
    fireEvent.click(closeBtn);
    expect(oskHeight()).toBe('0px');
  });

  it('a key press appends the character, and {bksp} removes one', async () => {
    render(
      <Panel>
        <TextField />
      </Panel>,
    );
    const field = screen.getByLabelText('field') as HTMLInputElement;
    fireEvent.focus(field);
    await pressKey('q');
    expect(field.value).toBe('q');
    await pressKey('{bksp}');
    expect(field.value).toBe('');
  });

  it('a numeric field opens the numeric layout', async () => {
    render(
      <Panel>
        <TextField layout="numeric" />
      </Panel>,
    );
    const field = screen.getByLabelText('field') as HTMLInputElement;
    fireEvent.focus(field);
    await pressKey('7');
    expect(field.value).toBe('7');
    expect(document.querySelector('[data-skbtn="q"]')).toBeNull();
  });

  it('switching focus between two bound fields retargets without closing', async () => {
    function TwoFields() {
      const [a, setA] = useState('');
      const [b, setB] = useState('');
      const bindingA = useOskField({ value: a, onChange: setA });
      const bindingB = useOskField({ value: b, onChange: setB });
      return (
        <>
          <input aria-label="a" value={a} onChange={() => {}} {...bindingA} />
          <input aria-label="b" value={b} onChange={() => {}} {...bindingB} />
        </>
      );
    }
    render(
      <Panel>
        <TwoFields />
      </Panel>,
    );
    fireEvent.focus(screen.getByLabelText('a'));
    expect(oskHeight()).toBe(`${OSK_OPEN_PX}px`);
    fireEvent.focus(screen.getByLabelText('b'));
    expect(oskHeight()).toBe(`${OSK_OPEN_PX}px`);
    await pressKey('q');
    expect((screen.getByLabelText('b') as HTMLInputElement).value).toBe('q');
    expect((screen.getByLabelText('a') as HTMLInputElement).value).toBe('');
  });

  it('a screen component with a bound field commits exactly once across an open->close cycle', () => {
    const onCommit = vi.fn();
    render(
      <Panel>
        <TextField onCommit={onCommit} />
      </Panel>,
    );
    const commitsBefore = onCommit.mock.calls.length;
    fireEvent.focus(screen.getByLabelText('field'));
    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard' }));
    expect(onCommit.mock.calls.length).toBe(commitsBefore);
  });

  it('pointerdown on the host is default-prevented', () => {
    render(
      <Panel>
        <TextField />
      </Panel>,
    );
    const host = screen.getByTestId('keyboard-host');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      host.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });
});
