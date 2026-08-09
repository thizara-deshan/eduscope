import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionBar } from './selection-bar.js';

describe('<SelectionBar/> (S-21 §2.4)', () => {
  it('renders the count and summed bytes', () => {
    render(<SelectionBar count={4} totalBytes={6_800_000_000} onCancel={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getByText(/4 selected/)).toBeInTheDocument();
    expect(screen.getByText(/6.8 GB/)).toBeInTheDocument();
  });

  it('Copy to USB fires onExport', () => {
    const onExport = vi.fn();
    render(<SelectionBar count={2} totalBytes={1_000_000_000} onCancel={vi.fn()} onExport={onExport} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy to USB/ }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('Cancel fires onCancel', () => {
    const onCancel = vi.fn();
    render(<SelectionBar count={2} totalBytes={1_000_000_000} onCancel={onCancel} onExport={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
