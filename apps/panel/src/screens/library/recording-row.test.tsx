import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Recording } from '@eduscope/shared';
import { RecordingRow } from './recording-row.js';

function rec(overrides: Partial<Recording>): Recording {
  return {
    id: 'R1', sessionId: 'S1', title: 'Data Structures — Lecture 12', hallDisplayName: 'Hall A',
    ownerUserId: 'U1', ownerDisplayName: 'A. Perera', startedAt: '2026-08-10T09:00:00.000Z',
    endedAt: '2026-08-10T09:48:00.000Z', state: 'ready', layoutPresetId: 'fifty-fifty',
    durationMs: 48 * 60_000, totalBytes: 2_100_000_000, segmentCount: 3,
    mergeState: 'done', uploadState: 'done',
    retentionDeleteAfter: '2026-11-10T09:00:00.000Z',
    deletedAt: null, deleteReason: null,
    ...overrides,
  };
}

const noop = () => {};

describe('<RecordingRow/> (S-21 §2.1/§8)', () => {
  it('body, Play and checkbox are distinct targets, each with the accessible name {title}, {badge}, {duration}', () => {
    render(
      <ul>
        <RecordingRow
          rec={rec({})}
          showOwner={false}
          selectable={true}
          selected={false}
          onOpen={noop}
          onPlay={noop}
          onToggle={noop}
          onMenu={noop}
        />
      </ul>,
    );
    const body = screen.getByRole('button', { name: 'Data Structures — Lecture 12, Uploaded, 48:00' });
    expect(body).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Play Data Structures/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Select Data Structures/ })).toBeInTheDocument();
  });

  it('owner is hidden when showOwner is false and shown when true', () => {
    const { rerender } = render(
      <ul>
        <RecordingRow rec={rec({})} showOwner={false} selectable={false} selected={false} onOpen={noop} onPlay={noop} onToggle={noop} onMenu={noop} />
      </ul>,
    );
    expect(screen.queryByText(/A\. Perera/)).not.toBeInTheDocument();

    rerender(
      <ul>
        <RecordingRow rec={rec({})} showOwner={true} selectable={false} selected={false} onOpen={noop} onPlay={noop} onToggle={noop} onMenu={noop} />
      </ul>,
    );
    expect(screen.getByText(/A\. Perera/)).toBeInTheDocument();
  });

  it('a tombstone row (deleted) has no Play affordance', () => {
    render(
      <ul>
        <RecordingRow
          rec={rec({ state: 'deleted', deletedAt: '2026-08-01T00:00:00.000Z', deleteReason: 'retention' })}
          showOwner={true}
          selectable={false}
          selected={false}
          onOpen={noop}
          onPlay={noop}
          onToggle={noop}
          onMenu={noop}
        />
      </ul>,
    );
    expect(screen.queryByRole('button', { name: /Play/ })).not.toBeInTheDocument();
    expect(screen.getByText(/removed after 14 days/)).toBeInTheDocument();
  });

  it('tapping the body toggles selection instead of opening detail when selectable', () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <ul>
        <RecordingRow rec={rec({})} showOwner={false} selectable={true} selected={false} onOpen={onOpen} onPlay={noop} onToggle={onToggle} onMenu={noop} />
      </ul>,
    );
    screen.getByRole('button', { name: /^Data Structures/ }).click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows Delete in ⋯ only when onDelete is supplied (admin)', () => {
    const { unmount } = render(
      <ul>
        <RecordingRow rec={rec({})} showOwner={false} selectable={false} selected={false} onOpen={noop} onPlay={noop} onToggle={noop} onMenu={noop} />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    unmount();

    const onDelete = vi.fn();
    render(
      <ul>
        <RecordingRow rec={rec({})} showOwner={false} selectable={false} selected={false} onOpen={noop} onPlay={noop} onToggle={noop} onMenu={noop} onDelete={onDelete} />
      </ul>,
    );
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
