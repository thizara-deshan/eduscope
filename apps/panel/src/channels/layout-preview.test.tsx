import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LayoutPreset } from '@eduscope/shared';
import { LayoutPreview } from './layout-preview.js';

const single: LayoutPreset = {
  id: 'cam-1', displayName: 'Lecturer only', description: 'desc', allowedChannels: ['local'],
  kind: 'single', canvas: { width: 1920, height: 1080 },
  tiles: [{ roleId: 'lecturer-cam', x: 0, y: 0, w: 1920, h: 1080, z: 0 }],
  parametric: false, outputs: [], passthroughEligible: true, requiredRoles: ['lecturer-cam'],
};

const composite: LayoutPreset = {
  id: 'fifty-fifty', displayName: 'Slides + lecturer', description: 'desc', allowedChannels: ['local'],
  kind: 'composite', canvas: { width: 1920, height: 1080 },
  tiles: [
    { roleId: 'presentation', x: 0, y: 0, w: 960, h: 1080, z: 0 },
    { roleId: 'lecturer-cam', x: 960, y: 0, w: 960, h: 1080, z: 0 },
  ],
  parametric: true, outputs: [], passthroughEligible: false, requiredRoles: ['presentation', 'lecturer-cam'],
};

const multiFile: LayoutPreset = {
  id: 'separate-files', displayName: 'Separate files', description: 'desc', allowedChannels: ['local'],
  kind: 'multi-file', canvas: { width: 1920, height: 1080 },
  tiles: [
    { roleId: 'presentation', x: 0, y: 0, w: 1920, h: 1080, z: 0 },
    { roleId: 'lecturer-cam', x: 0, y: 0, w: 1920, h: 1080, z: 0 },
  ],
  parametric: false,
  outputs: [
    { streamKey: 'presentation', roleIds: ['presentation'], includeAudio: false },
    { streamKey: 'lecturer-cam', roleIds: ['lecturer-cam'], includeAudio: true },
  ],
  passthroughEligible: false, requiredRoles: ['presentation', 'lecturer-cam'],
};

describe('LayoutPreview', () => {
  it('renders a single-kind preset as one full-canvas frame', () => {
    render(<LayoutPreview preset={single} />);
    const preview = screen.getByTestId('layout-preview');
    expect(preview).toHaveAttribute('data-kind', 'single');
    expect(screen.getByText('Lecturer Camera')).toBeInTheDocument();
  });

  it('renders a composite preset with one positioned frame per tile', () => {
    render(<LayoutPreview preset={composite} />);
    expect(screen.getByTestId('layout-preview')).toHaveAttribute('data-kind', 'composite');
    expect(screen.getByText('Presentation')).toBeInTheDocument();
    expect(screen.getByText('Lecturer Camera')).toBeInTheDocument();
  });

  it('renders a multi-file preset as one labelled frame per output, not overlapping full-canvas tiles', () => {
    render(<LayoutPreview preset={multiFile} />);
    const preview = screen.getByTestId('layout-preview');
    expect(preview).toHaveAttribute('data-kind', 'multi-file');
    expect(screen.getByText(/Presentation · file 1/)).toBeInTheDocument();
    expect(screen.getByText(/Lecturer Camera · file 2/)).toBeInTheDocument();
  });

  it('hides labels in compact mode', () => {
    render(<LayoutPreview preset={single} compact />);
    expect(screen.queryByText('Lecturer Camera')).toBeNull();
  });
});
