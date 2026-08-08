import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StreamTarget } from '@eduscope/shared';
import { StreamTargetList } from './stream-target-list.js';

const configured: StreamTarget = {
  id: 'T1', platform: 'youtube', displayName: 'Main YouTube', ingestUrl: 'rtmp://a',
  hasStreamKey: true, requiresTlsBridge: false, enabled: true, lastPreflightAt: null, lastPreflightResult: 'ok',
};
const notConfigured: StreamTarget = {
  id: 'T2', platform: 'custom-rtmp', displayName: 'Backup', ingestUrl: 'rtmp://b',
  hasStreamKey: false, requiresTlsBridge: true, enabled: true, lastPreflightAt: null, lastPreflightResult: null,
};

describe('StreamTargetList', () => {
  it('shows an explanatory empty state with no targets', () => {
    render(<StreamTargetList targets={[]} onEdit={vi.fn()} onDeleteClick={vi.fn()} />);
    expect(screen.getByTestId('stream-targets-empty')).toBeInTheDocument();
  });

  it('renders each target with its configured/not-configured key status', () => {
    render(<StreamTargetList targets={[configured, notConfigured]} onEdit={vi.fn()} onDeleteClick={vi.fn()} />);
    expect(screen.getByText('Main YouTube')).toBeInTheDocument();
    expect(screen.getByText('Backup')).toBeInTheDocument();
    const rows = screen.getAllByText(/Configured|Not configured/);
    expect(rows.map((r) => r.textContent)).toEqual(['Configured', 'Not configured']);
  });

  it('never shows a stream key anywhere', () => {
    render(<StreamTargetList targets={[configured]} onEdit={vi.fn()} onDeleteClick={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/mock-stream-key/);
  });

  it('edit and delete call back with the target', () => {
    const onEdit = vi.fn();
    const onDeleteClick = vi.fn();
    render(<StreamTargetList targets={[configured]} onEdit={onEdit} onDeleteClick={onDeleteClick} />);
    screen.getByRole('button', { name: 'Edit' }).click();
    expect(onEdit).toHaveBeenCalledWith(configured);
    screen.getByRole('button', { name: 'Delete' }).click();
    expect(onDeleteClick).toHaveBeenCalledWith(configured);
  });
});
