import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DeviceHealth } from '@eduscope/shared';
import { DeviceHealthCard } from './device-health-card.js';

const health = (overrides: Partial<DeviceHealth> = {}): DeviceHealth => ({
  deviceId: 'D1', observedAt: '2026-08-10T09:00:00Z', storageTotalBytes: 500_000_000_000,
  storageFreeBytes: 260_000_000_000, storagePressure: 'ok', diskHealth: 'good',
  captureCardState: 'present', publisherStates: {}, ntpSynced: true, clockOffsetMs: 12,
  lastBootAt: '2026-08-10T06:00:00Z', cpuLoad1m: 0.42, tempC: 51.5,
  ...overrides,
});

function build(props: Partial<Parameters<typeof DeviceHealthCard>[0]>) {
  return render(createElement(MemoryRouter, null, createElement(DeviceHealthCard, {
    health: health(), isStale: false, ...props,
  })));
}

describe('DeviceHealthCard', () => {
  it('health stale (INV-DH-2/C-3): every value reads checking, never last-healthy', () => {
    build({ isStale: true });
    const checking = screen.getAllByText('— checking…');
    expect(checking.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('Present')).not.toBeInTheDocument();
    expect(screen.queryByText('Good')).not.toBeInTheDocument();
  });

  it('capture present', () => {
    build({ health: health({ captureCardState: 'present' }) });
    expect(screen.getByText('Present')).toBeInTheDocument();
  });

  it('capture absent', () => {
    build({ health: health({ captureCardState: 'absent' }) });
    expect(screen.getByText('Not detected')).toBeInTheDocument();
  });

  it('capture recovering: states the budget cap, not a live counter (W6-D-1)', () => {
    build({ health: health({ captureCardState: 'recovering' }) });
    expect(screen.getAllByText(/up to 2 recovery attempts per hour/).length).toBeGreaterThan(0);
  });

  it('capture failed: needs a person and camera-only recording still works (A-08)', () => {
    build({ health: health({ captureCardState: 'failed' }) });
    expect(screen.getByText(/camera-only recording still works/i)).toBeInTheDocument();
  });

  it('publisher exited: surfaces the lastErrorCode', () => {
    build({ health: health({ publisherStates: {
      'mic-lecturer': { status: 'exited', lastErrorCode: 'alsa_xrun', since: '2026-08-10T06:00:00Z' },
    } }) });
    expect(screen.getByText(/alsa_xrun/)).toBeInTheDocument();
  });

  it('SMART unknown is legitimate, not hardcoded Good (C-7)', () => {
    build({ health: health({ diskHealth: 'unknown' }) });
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});
