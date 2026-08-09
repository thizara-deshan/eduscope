import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryFilters } from './library-filters.js';

describe('<LibraryFilters/> (S-21 §2.3) — chips map to real server parameters', () => {
  it('typing Search calls onChange with q', () => {
    const onChange = vi.fn();
    render(<LibraryFilters value={{}} isAdmin={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Search recordings'), { target: { value: 'networks' } });
    expect(onChange).toHaveBeenCalledWith({ q: 'networks' });
  });

  it('the Owner picker is absent for a lecturer and present for admin', () => {
    const { rerender } = render(<LibraryFilters value={{}} isAdmin={false} onChange={vi.fn()} />);
    expect(screen.queryByLabelText('Filter by owner')).not.toBeInTheDocument();

    rerender(<LibraryFilters value={{}} isAdmin={true} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Filter by owner')).toBeInTheDocument();
    expect(screen.getByLabelText('Show deleted')).toBeInTheDocument();
  });

  it('clearing a chip re-issues without the param', () => {
    const onChange = vi.fn();
    render(<LibraryFilters value={{ q: 'networks' }} isAdmin={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(onChange).toHaveBeenCalledWith({ q: undefined });
  });
});
