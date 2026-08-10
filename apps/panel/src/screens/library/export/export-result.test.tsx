import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { UsbVolume } from '@eduscope/shared';
import { ExportResult } from './export-result.js';

const kingston: UsbVolume = {
  devicePath: '/dev/sdb1', mountPath: '/media/usb0', label: 'KINGSTON',
  capacityBytes: 32_000_000_000, freeBytes: 14_200_000_000,
};

describe('<ExportResult/> (S-23 §2.5/§2.6)', () => {
  it('completed: "Safe to remove" is aria-live', () => {
    render(<ExportResult state="completed" volume={kingston} error={null} onRetry={vi.fn()} onDone={vi.fn()} />);
    const live = screen.getByText('Safe to remove the drive.').closest('[aria-live]');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('drive-removed asserts the source is safe and offers Try again', () => {
    const onRetry = vi.fn();
    render(<ExportResult state="drive-removed" volume={null} error={null} onRetry={onRetry} onDone={vi.fn()} />);
    expect(screen.getByText(/removed before the copy finished/)).toBeInTheDocument();
    expect(screen.getByText(/recordings are safe on the device/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('failed asserts source safety with the named error', () => {
    render(<ExportResult state="failed" volume={null} error="disk write error" onRetry={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText(/disk write error/)).toBeInTheDocument();
    expect(screen.getByText(/recordings are safe on the device/)).toBeInTheDocument();
  });

  it('cancelled is a calm terminal', () => {
    const onDone = vi.fn();
    render(<ExportResult state="cancelled" volume={null} error={null} onRetry={vi.fn()} onDone={onDone} />);
    expect(screen.getByText('Copy cancelled.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
