import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChannelConfig, LayoutPreset } from '@eduscope/shared';
import { LayoutPresetPicker } from './layout-preset-picker.js';
import type { ChannelPresetOption } from './channel-queries.js';

function preset(id: string, allowedChannels: LayoutPreset['allowedChannels']): LayoutPreset {
  return {
    id: id as LayoutPreset['id'], displayName: id, description: `${id} description`, allowedChannels,
    kind: 'single', canvas: { width: 1920, height: 1080 },
    tiles: [{ roleId: 'lecturer-cam', x: 0, y: 0, w: 1920, h: 1080, z: 0 }],
    parametric: false, outputs: [], passthroughEligible: true, requiredRoles: ['lecturer-cam'],
  };
}

const config: ChannelConfig = {
  channelId: 'meeting', alwaysOn: false, enabledByDefault: false, presetId: 'cam-1',
  ratioA: null, ratioB: null, streamTargetIds: null, updatedAt: '2026-01-01T00:00:00.000Z',
};

const options: ChannelPresetOption[] = [
  { preset: preset('cam-1', ['meeting']), disabled: false, reason: null },
  { preset: preset('cam-2', ['meeting']), disabled: true, reason: 'Needs Students Camera, which is not connected.' },
];

describe('LayoutPresetPicker', () => {
  it('renders a preview, name, description, and disabled reason per card', () => {
    render(
      <LayoutPresetPicker options={options} config={config} phase="idle" problem={null} pendingPresetId={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('cam-1')).toBeInTheDocument();
    expect(screen.getByText('cam-1 description')).toBeInTheDocument();
    expect(screen.getByText('Needs Students Camera, which is not connected.')).toBeInTheDocument();
  });

  it('meets the 150x110 minimum card size', () => {
    render(
      <LayoutPresetPicker options={options} config={config} phase="idle" problem={null} pendingPresetId={null} onSelect={vi.fn()} />,
    );
    const card = screen.getByRole('button', { name: /cam-1/ });
    expect(getComputedStyle(card).minWidth).toBe('150px');
    expect(getComputedStyle(card).minHeight).toBe('110px');
  });

  it('tracks aria-pressed from the applied config, not the tap, and blocks invalid options', () => {
    const onSelect = vi.fn();
    render(
      <LayoutPresetPicker options={options} config={config} phase="idle" problem={null} pendingPresetId={null} onSelect={onSelect} />,
    );
    expect(screen.getByRole('button', { name: /cam-1/ })).toHaveAttribute('aria-pressed', 'true');
    const invalidCard = screen.getByRole('button', { name: /cam-2/ });
    expect(invalidCard).toHaveAttribute('aria-pressed', 'false');
    expect(invalidCard).toBeDisabled();
    invalidCard.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows Saving… only on the tapped card', () => {
    render(
      <LayoutPresetPicker
        options={options} config={config} phase="saving" problem={null} pendingPresetId="cam-1" onSelect={vi.fn()}
      />,
    );
    const card1 = screen.getByRole('button', { name: /cam-1/ });
    expect(card1).toHaveTextContent('Saving…');
  });

  it('renders the applied and refused messages in adjacent polite live regions', () => {
    const { rerender } = render(
      <LayoutPresetPicker options={options} config={config} phase="applied" problem={null} pendingPresetId={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText('Layout applied.')).toBeInTheDocument();

    rerender(
      <LayoutPresetPicker
        options={options} config={config} phase="refused"
        problem={{ status: 422, code: 'config.invalid', title: 'This layout could not be applied.' }}
        pendingPresetId={null} onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText('This layout could not be applied.')).toBeInTheDocument();
  });
});
