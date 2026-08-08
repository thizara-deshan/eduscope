import { Profiler } from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTelemetryStore } from '../../store/telemetry-store.js';
import { LevelMeter } from './level-meter.js';

describe('LevelMeter', () => {
  beforeEach(() => useTelemetryStore.getState().reset());

  it('renders the approved twenty CSS-driven segments', () => {
    render(<LevelMeter roleId="mic-lecturer" />);
    expect(screen.getAllByTestId('level-segment')).toHaveLength(20);
  });

  it('writes telemetry to --level without using React state', () => {
    render(<LevelMeter roleId="mic-lecturer" />);
    act(() => useTelemetryStore.getState().setLevel('mic-lecturer', 0.625));
    expect(screen.getByRole('meter').style.getPropertyValue('--level')).toBe('0.625');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '63');
  });

  it('does not render again across thirty telemetry ticks', () => {
    let commits = 0;
    render(
      <Profiler id="level-meter" onRender={() => { commits += 1; }}>
        <LevelMeter roleId="mic-lecturer" />
      </Profiler>,
    );
    act(() => {
      for (let index = 0; index < 30; index += 1) {
        useTelemetryStore.getState().setLevel('mic-lecturer', index / 30);
      }
    });
    expect(commits).toBe(1);
  });
});
