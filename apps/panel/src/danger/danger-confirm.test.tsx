import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../styles/tokens.css';
import { DangerConfirm, type DangerConfirmProps } from './danger-confirm.js';

const props = (overrides: Partial<DangerConfirmProps> = {}): DangerConfirmProps => ({
  title: 'Take over this recording?',
  body: 'The current lecturer will lose control.',
  confirmLabel: 'Take over',
  pendingLabel: 'Taking over…',
  state: 'confirm',
  onCancel: vi.fn(),
  onConfirm: vi.fn(),
  ...overrides,
});

describe('DangerConfirm', () => {
  it('renders title, body, and two live buttons in confirm', () => {
    render(<DangerConfirm {...props()} />);
    expect(screen.getByText('Take over this recording?')).toBeInTheDocument();
    expect(screen.getByText('The current lecturer will lose control.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Take over' })).toBeEnabled();
  });

  it('shows the pending label and disables both buttons in pending', () => {
    render(<DangerConfirm {...props({ state: 'pending' })} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Taking over…' })).toBeDisabled();
  });

  it('shows the reason and replaces the destructive button with the remedy in refused', () => {
    render(<DangerConfirm {...props({
      state: 'refused',
      message: 'That lecture has already ended.',
      remedy: <a href="/recordings">Open recordings</a>,
      cancelLabel: 'Close',
    })} />);
    expect(screen.getByTestId('danger-message')).toHaveTextContent('That lecture has already ended.');
    expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open recordings' })).toBeInTheDocument();
  });

  it('renders nothing in done', () => {
    const { container } = render(<DangerConfirm {...props({ state: 'done' })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reserves a 40px message slot before a message exists', () => {
    render(<DangerConfirm {...props()} />);
    const slot = screen.getByTestId('danger-message');
    expect(slot).toBeInTheDocument();
    expect(slot).toBeEmptyDOMElement();
    expect(getComputedStyle(slot).minHeight).toBe('40px');
  });

  it('opens focus on Cancel', () => {
    render(<DangerConfirm {...props()} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('wires alertdialog labelling and description to real ids', () => {
    render(<DangerConfirm {...props()} />);
    const dialog = screen.getByRole('alertdialog');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    const body = document.getElementById(dialog.getAttribute('aria-describedby')!);
    expect(title).toHaveTextContent('Take over this recording?');
    expect(body).toHaveTextContent('The current lecturer will lose control.');
  });

  it('places the destructive button last in focusable DOM order', () => {
    render(<DangerConfirm {...props()} />);
    const dialog = screen.getByRole('alertdialog');
    const focusable = dialog.querySelectorAll('button:not([disabled]), a[href]');
    expect(focusable.item(focusable.length - 1)).toBe(screen.getByRole('button', { name: 'Take over' }));
  });

  it('cancels on Escape when not pending', () => {
    const onCancel = vi.fn();
    render(<DangerConfirm {...props({ onCancel })} />);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not cancel on Escape while pending', () => {
    const onCancel = vi.fn();
    render(<DangerConfirm {...props({ onCancel, state: 'pending' })} />);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
