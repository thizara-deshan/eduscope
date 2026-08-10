import { createElement } from 'react';
import { act } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CopyId } from './copy-id.js';

describe('CopyId', () => {
  it('copies the value and announces "Copied {label}" via aria-live', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(createElement(CopyId, { value: '01J8Z-K3QR', label: 'device ID' }));
    await act(async () => {
      screen.getByRole('button', { name: 'Copy device ID' }).click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('01J8Z-K3QR');
    expect(screen.getByText('Copied device ID')).toBeInTheDocument();
  });
});
