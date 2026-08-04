import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWsStore } from '../store/ws-store.js';
import '../styles/tokens.css';
import { RecordingChrome } from './recording-chrome.js';

const envelope = (payload: unknown, seq = 0) =>
  ({ event: 'recording.state', at: '2026-07-30T09:00:00+00:00', seq, payload }) as never;

function setRecording(state: string, extra: Record<string, unknown> = {}) {
  useWsStore.getState().ingest(envelope({ state, ...extra }));
}

describe('RecordingChrome', () => {
  beforeEach(() => {
    useWsStore.getState().reset();
  });

  it('idle chrome — no frame, no notch', () => {
    setRecording('idle');
    render(<RecordingChrome />);
    expect(screen.queryByTestId('recording-frame')).toBeNull();
    expect(screen.queryByTestId('recording-notch')).toBeNull();
  });

  it('starting — no frame either (B-12: a start that then fails must never have read as recording)', () => {
    setRecording('starting');
    render(<RecordingChrome />);
    expect(screen.queryByTestId('recording-frame')).toBeNull();
    expect(screen.queryByTestId('recording-notch')).toBeNull();
  });

  it('recording chrome — 4px --record frame + RECORDING notch', () => {
    setRecording('recording');
    render(<RecordingChrome />);
    const frame = screen.getByTestId('recording-frame');
    expect(frame.className).not.toContain('--paused');
    expect(frame.className).not.toContain('--saving');
    expect(screen.getByTestId('recording-notch').textContent).toContain('RECORDING');
    expect(document.querySelector('.us-recnotch__dot')).not.toBeNull();
  });

  it('paused chrome — amber frame + PAUSED notch, dot animation off', () => {
    setRecording('paused');
    render(<RecordingChrome />);
    expect(screen.getByTestId('recording-frame').className).toContain('us-recframe--paused');
    expect(screen.getByTestId('recording-notch').textContent).toContain('PAUSED');
    expect(document.querySelector('.us-recnotch__dot')).toBeNull();
  });

  it('saving chrome — neutral frame + SAVING notch, sub-caption differs stopping vs finalizing', () => {
    setRecording('stopping');
    const { rerender } = render(<RecordingChrome />);
    expect(screen.getByTestId('recording-frame').className).toContain('us-recframe--saving');
    expect(screen.getByTestId('recording-notch').textContent).toContain('Closing the recording');

    act(() => setRecording('finalizing', {}));
    rerender(<RecordingChrome />);
    expect(screen.getByTestId('recording-notch').textContent).toContain('Finishing the file');
  });

  it('saved — transient Saved confirmation, then idle chrome', () => {
    vi.useFakeTimers();
    setRecording('recording');
    const { rerender } = render(<RecordingChrome />);
    act(() => setRecording('completed'));
    rerender(<RecordingChrome />);
    expect(screen.getByTestId('recording-saved')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.queryByTestId('recording-saved')).toBeNull();
    vi.useRealTimers();
  });

  it('error — error card with a plain-language cause; the frame never appears', () => {
    setRecording('error', { errorMessage: 'The storage device was removed.' });
    render(<RecordingChrome />);
    expect(screen.getByTestId('recording-error').textContent).toBe('The storage device was removed.');
    expect(screen.queryByTestId('recording-frame')).toBeNull();
  });

  it('error renders a plain-language fallback when errorMessage is null, never the bare errorCode', () => {
    setRecording('error', { errorMessage: null, errorCode: 'recording.pipeline-lost' });
    render(<RecordingChrome />);
    const text = screen.getByTestId('recording-error').textContent;
    expect(text).not.toContain('recording.pipeline-lost');
    expect(text).toBeTruthy();
  });

  it('the frame is position: absolute and its border-radius equals the panel\'s', () => {
    setRecording('recording');
    render(<RecordingChrome />);
    const frame = screen.getByTestId('recording-frame');
    expect(getComputedStyle(frame).position).toBe('absolute');
    expect(getComputedStyle(frame).borderRadius).toBe(getComputedStyle(document.documentElement).getPropertyValue('--radius-panel').trim());
  });

  it('with stale:true and recording, the frame is still present (U-2)', () => {
    setRecording('recording');
    useWsStore.getState().setConnection({ phase: 'stale', attempt: 1, since: '2026-07-30T09:00:10+00:00' });
    render(<RecordingChrome />);
    expect(screen.getByTestId('recording-frame')).toBeInTheDocument();
  });
});
