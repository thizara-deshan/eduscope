import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthMessage } from './auth-message.js';

describe('AuthMessage', () => {
  it('renders the slot with no value: present, no text, 40px computed height', () => {
    render(<AuthMessage value={null} />);
    const slot = screen.getByTestId('auth-message');
    expect(slot.textContent).toBe('');
    expect(getComputedStyle(slot).height).toBe('40px');
  });

  it('carries aria-live="polite" with and without a value', () => {
    const { rerender } = render(<AuthMessage value={null} />);
    expect(screen.getByTestId('auth-message')).toHaveAttribute('aria-live', 'polite');
    rerender(<AuthMessage value={{ kind: 'error', text: 'nope' }} />);
    expect(screen.getByTestId('auth-message')).toHaveAttribute('aria-live', 'polite');
  });

  it('renders each kind with its own class and text', () => {
    const { rerender } = render(<AuthMessage value={{ kind: 'error', text: 'Error text' }} />);
    let slot = screen.getByTestId('auth-message');
    expect(slot.className).toContain('us-authmsg--error');
    expect(slot.textContent).toBe('Error text');

    rerender(<AuthMessage value={{ kind: 'warning', text: 'Warning text' }} />);
    slot = screen.getByTestId('auth-message');
    expect(slot.className).toContain('us-authmsg--warning');
    expect(slot.textContent).toBe('Warning text');

    rerender(<AuthMessage value={{ kind: 'info', text: 'Info text' }} />);
    slot = screen.getByTestId('auth-message');
    expect(slot.className).toContain('us-authmsg--info');
    expect(slot.textContent).toBe('Info text');
  });

  it('keeps the same element node across null -> error -> null (never unmounts)', () => {
    const { rerender } = render(<AuthMessage value={null} />);
    const first = screen.getByTestId('auth-message');
    rerender(<AuthMessage value={{ kind: 'error', text: 'x' }} />);
    expect(screen.getByTestId('auth-message')).toBe(first);
    rerender(<AuthMessage value={null} />);
    expect(screen.getByTestId('auth-message')).toBe(first);
  });
});
