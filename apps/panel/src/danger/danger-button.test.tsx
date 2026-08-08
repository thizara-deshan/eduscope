import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../styles/tokens.css';
import { DangerButton } from './danger-button.js';

describe('DangerButton', () => {
  it('renders quiet and solid treatments at the 56px touch height', () => {
    const { rerender } = render(<DangerButton variant="quiet">Delete</DangerButton>);
    const quiet = screen.getByRole('button', { name: 'Delete' });
    expect(getComputedStyle(quiet).backgroundColor).toBe('rgba(198, 40, 40, 0.12)');
    expect(getComputedStyle(quiet).color).toBe('#c62828');
    expect(getComputedStyle(quiet).minHeight).toBe('56px');

    rerender(<DangerButton variant="solid">Delete</DangerButton>);
    const solid = screen.getByRole('button', { name: 'Delete' });
    expect(getComputedStyle(solid).backgroundColor).toBe('#c62828');
    expect(getComputedStyle(solid).color).toBe('#fff');
    expect(getComputedStyle(solid).minHeight).toBe('56px');
  });

  it('has no click behavior by default and forwards disabled', () => {
    const click = vi.fn();
    const { rerender } = render(<DangerButton variant="quiet">Delete</DangerButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(click).not.toHaveBeenCalled();

    rerender(<DangerButton variant="quiet" disabled onClick={click}>Delete</DangerButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(click).not.toHaveBeenCalled();
  });

  it('differs by border presence as well as colour', () => {
    render(
      <>
        <DangerButton variant="quiet">Quiet</DangerButton>
        <DangerButton variant="solid">Solid</DangerButton>
      </>,
    );
    expect(getComputedStyle(screen.getByRole('button', { name: 'Quiet' })).borderStyle).toBe('solid');
    expect(getComputedStyle(screen.getByRole('button', { name: 'Solid' })).borderStyle).not.toBe('solid');
  });
});
