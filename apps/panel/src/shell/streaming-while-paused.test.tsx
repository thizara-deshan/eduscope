import { render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useWsStore } from '../store/ws-store.js';
import { StreamingWhilePaused } from './streaming-while-paused.js';

const envelope = (event: string, payload: unknown, seq: number) =>
  ({ event, at: '2026-01-01T00:00:00.000Z', seq, payload }) as never;

describe('StreamingWhilePaused', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('paused + meeting on -> renders and has no dismiss control', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('recording.state', { state: 'paused' }, 0));
    s.ingest(envelope('channel.state', { channelId: 'meeting', state: 'on' }, 1));
    render(<StreamingWhilePaused />);
    expect(screen.getByTestId('streaming-while-paused')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('paused + all channels off -> absent', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('recording.state', { state: 'paused' }, 0));
    s.ingest(envelope('channel.state', { channelId: 'meeting', state: 'off' }, 1));
    render(<StreamingWhilePaused />);
    expect(screen.queryByTestId('streaming-while-paused')).toBeNull();
  });

  it('recording + meeting on -> absent', () => {
    const s = useWsStore.getState();
    s.ingest(envelope('recording.state', { state: 'recording' }, 0));
    s.ingest(envelope('channel.state', { channelId: 'meeting', state: 'on' }, 1));
    render(<StreamingWhilePaused />);
    expect(screen.queryByTestId('streaming-while-paused')).toBeNull();
  });
});
