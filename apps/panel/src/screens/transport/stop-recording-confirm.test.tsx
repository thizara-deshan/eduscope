import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StopRecordingConfirm } from './stop-recording-confirm.js';

describe('StopRecordingConfirm', () => {
  it('uses clear confirmation copy and forwards confirm once', () => {
    const onConfirm = vi.fn();
    render(<StopRecordingConfirm disabled={false} onCancel={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole('alertdialog', { name: 'Stop recording?' })).toHaveTextContent(
      'Are you sure you want to stop recording?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop Recording' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
