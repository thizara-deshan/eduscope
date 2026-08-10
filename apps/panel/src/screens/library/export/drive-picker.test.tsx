import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { UsbVolume } from '@eduscope/shared';
import { DrivePicker } from './drive-picker.js';

function volume(overrides: Partial<UsbVolume>): UsbVolume {
  return {
    devicePath: '/dev/sdb1', mountPath: '/media/usb0', label: 'KINGSTON',
    capacityBytes: 32_000_000_000, freeBytes: 14_200_000_000,
    ...overrides,
  };
}

describe('<DrivePicker/> (S-23 §2.2/C-1/C-6) — cards, never a dropdown', () => {
  it('a card with freeBytes < needBytes shows the shortfall and is not selectable', () => {
    const onPick = vi.fn();
    render(<DrivePicker volumes={[volume({ label: 'Lecture Backup', freeBytes: 3_100_000_000 })]} needBytes={6_800_000_000} onPick={onPick} />);
    const card = screen.getByRole('button', { name: /not enough/ });
    expect(card).toBeDisabled();
    expect(screen.getByText(/Not enough room/)).toBeInTheDocument();
  });

  it('announces {label}, {free} free, {enough/not enough} for {bytes} and calls onPick when a card with room is tapped', () => {
    const onPick = vi.fn();
    render(<DrivePicker volumes={[volume({})]} needBytes={6_800_000_000} onPick={onPick} />);
    const card = screen.getByRole('button', { name: /KINGSTON, 14 GB free, enough for 6.8 GB/ });
    fireEvent.click(card);
    expect(onPick).toHaveBeenCalledWith('/dev/sdb1');
  });

  it('nothing is auto-selected (EXP-D-1)', () => {
    render(<DrivePicker volumes={[volume({})]} needBytes={1_000} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /KINGSTON/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
