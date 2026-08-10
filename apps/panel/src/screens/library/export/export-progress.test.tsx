import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExportJobPayload } from '@eduscope/shared';
import { ExportProgress } from './export-progress.js';

function job(overrides: Partial<ExportJobPayload> = {}): ExportJobPayload {
  return { jobId: 'J1', state: 'copying', bytesCopied: 3_900_000_000, bytesTotal: 6_800_000_000, error: null, ...overrides };
}

describe('<ExportProgress/> (S-23 §2.4/C-2)', () => {
  it('the bar and percentage read real bytesCopied/bytesTotal, never freeBytes', () => {
    render(<ExportProgress job={job({})} etaSeconds={120} onCancel={vi.fn()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '57');
    expect(screen.getByText(/3.9 GB of 6.8 GB/)).toBeInTheDocument();
    expect(screen.getByText(/about 2 min left/)).toBeInTheDocument();
  });

  it('shows "Starting…" before an ETA is available', () => {
    render(<ExportProgress job={job({ bytesCopied: 0 })} etaSeconds={null} onCancel={vi.fn()} />);
    expect(screen.getByText(/Starting…/)).toBeInTheDocument();
  });

  it('Cancel copy fires onCancel', () => {
    const onCancel = vi.fn();
    render(<ExportProgress job={job({})} etaSeconds={60} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel copy' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
