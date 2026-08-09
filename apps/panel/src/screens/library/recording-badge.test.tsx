import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Recording } from '@eduscope/shared';
import { RecordingBadge } from './recording-badge.js';

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
const PAST = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();

function rec(overrides: Partial<Recording>): Recording {
  return {
    id: 'REC1', sessionId: 'SESS1', title: 'Lecture', hallDisplayName: 'Hall A',
    ownerUserId: 'U1', ownerDisplayName: 'A. Perera', startedAt: '2026-08-10T09:00:00.000Z',
    endedAt: '2026-08-10T09:50:00.000Z', state: 'ready', layoutPresetId: 'fifty-fifty',
    durationMs: 3_000_000, totalBytes: 1_000_000, segmentCount: 1,
    mergeState: 'done', uploadState: 'done', retentionDeleteAfter: FUTURE,
    deletedAt: null, deleteReason: null,
    ...overrides,
  };
}

describe('<RecordingBadge/> — renders the §3 derivation without a data source', () => {
  it('renders the label text for a done recording', () => {
    render(<RecordingBadge rec={rec({ uploadState: 'done' })} />);
    expect(screen.getByText('Uploaded')).toBeInTheDocument();
  });

  it('renders the label text for a dead-letter recording', () => {
    render(<RecordingBadge rec={rec({ uploadState: 'dead-letter' })} />);
    expect(screen.getByText('Upload needs attention')).toBeInTheDocument();
  });

  it('renders the secondary "kept" line when #9 holds', () => {
    render(<RecordingBadge rec={rec({ uploadState: 'failed', retentionDeleteAfter: PAST })} />);
    expect(screen.getByText("Kept — never uploaded (won't auto-delete)")).toBeInTheDocument();
  });

  it('the status reads without colour — the word is present as text, not just a class', () => {
    render(<RecordingBadge rec={rec({ uploadState: 'dead-letter' })} />);
    const el = screen.getByText('Upload needs attention');
    expect(el.textContent).toContain('Upload needs attention');
  });

  it('the glyph is aria-hidden', () => {
    const { container } = render(<RecordingBadge rec={rec({ uploadState: 'done' })} />);
    const glyph = container.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
  });
});
