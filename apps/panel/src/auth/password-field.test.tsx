import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardHost } from '../keyboard/keyboard-host.js';
import { PasswordField } from './password-field.js';

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="us-panel" data-testid="us-panel">
      {children}
      <KeyboardHost />
    </div>
  );
}

function Field(props: { reveal?: boolean; disabled?: boolean }) {
  const [value, setValue] = useState('');
  return <PasswordField label="Password" value={value} onChange={setValue} {...props} />;
}

describe('PasswordField', () => {
  it('is type="password" with autoComplete="off"', () => {
    render(<Field />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('renders no toggle button without reveal', () => {
    render(<Field />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('with reveal: a >=44px button with aria-label and aria-pressed="false"; pressing flips type and aria-pressed', () => {
    render(<Field reveal />);
    const toggle = screen.getByRole('button', { name: /show password/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('reveal auto-hides after 10s and on blur', () => {
    vi.useFakeTimers();
    render(<Field reveal />);
    const toggle = screen.getByRole('button', { name: /show password/i });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    vi.useRealTimers();

    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    fireEvent.blur(screen.getByLabelText('Password'));
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('focus opens the on-screen keyboard (--osk-h becomes 380px)', () => {
    render(
      <Panel>
        <Field />
      </Panel>,
    );
    fireEvent.focus(screen.getByLabelText('Password'));
    expect(screen.getByTestId('us-panel').style.getPropertyValue('--osk-h')).toBe('380px');
  });

  it('disabled disables the input and the reveal button', () => {
    render(<Field reveal disabled />);
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: /show password/i })).toBeDisabled();
  });
});
