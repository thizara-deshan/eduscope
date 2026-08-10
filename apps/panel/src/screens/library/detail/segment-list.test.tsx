import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RecordingSegment } from '@eduscope/shared';
import { SegmentList } from './segment-list.js';

function seg(overrides: Partial<RecordingSegment>): RecordingSegment {
  return {
    id: 'S1', recordingId: 'R1', index: 0, startedAt: '2026-08-10T09:00:00.000Z',
    endedAt: '2026-08-10T09:24:00.000Z', durationMs: 24 * 60_000, endReason: 'stop', state: 'finalized',
    ...overrides,
  };
}

describe('<SegmentList/> (S-22 §2.1/C-3/SEG-5)', () => {
  it('renders the seam word for a truncated segment ended early', () => {
    render(<SegmentList segments={[seg({ state: 'truncated', endReason: 'error' })]} />);
    expect(screen.getByText(/seam: ended early/)).toBeInTheDocument();
  });

  it('renders the seam word "pipeline restart" for a crash-ended segment', () => {
    render(<SegmentList segments={[seg({ state: 'finalized', endReason: 'crash' })]} />);
    expect(screen.getByText(/seam: pipeline restart/)).toBeInTheDocument();
  });

  it('renders "no usable footage" for a failed segment', () => {
    render(<SegmentList segments={[seg({ state: 'failed', endReason: null })]} />);
    expect(screen.getByText(/no usable footage/)).toBeInTheDocument();
  });
});
