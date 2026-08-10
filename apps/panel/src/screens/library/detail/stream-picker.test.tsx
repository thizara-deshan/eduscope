import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { RecordingFile } from '@eduscope/shared';
import { StreamPicker } from './stream-picker.js';

function file(overrides: Partial<RecordingFile>): RecordingFile {
  return {
    id: 'F1', recordingId: 'R1', segmentId: 'SEG1', kind: 'merged', streamKey: 'main',
    container: 'mp4', sizeBytes: 1_000_000, durationMs: 60_000, state: 'finalized',
    hasAudio: true, isUploadable: true,
    ...overrides,
  };
}

describe('<StreamPicker/> (S-22 §2.3/C-2)', () => {
  it('is absent for one streamKey', () => {
    const { container } = render(
      <StreamPicker files={[file({})]} value="main" onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is present and switches source for two streamKeys, keyed on streamKey never file index', () => {
    const onChange = vi.fn();
    render(
      <StreamPicker
        files={[file({ id: 'F1', streamKey: 'composite' }), file({ id: 'F2', streamKey: 'camera-2' })]}
        value="composite"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'camera-2' }));
    expect(onChange).toHaveBeenCalledWith('camera-2');
  });
});
