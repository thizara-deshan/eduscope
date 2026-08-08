import { useEffect, useRef, type CSSProperties } from 'react';
import type { SourceRoleId } from '@eduscope/shared';
import { useTelemetryStore } from '../../store/telemetry-store.js';
import './sources.css';

const DEFAULT_SEGMENTS = 20;

export function LevelMeter({
  roleId,
  segments = DEFAULT_SEGMENTS,
}: {
  readonly roleId: SourceRoleId;
  readonly segments?: number;
}): JSX.Element {
  const meterRef = useRef<HTMLDivElement>(null);
  const initial = useTelemetryStore.getState().audioLevels[roleId] ?? 0;

  useEffect(() => {
    const paint = (rms: number | undefined) => {
      const level = rms ?? 0;
      meterRef.current?.style.setProperty('--level', String(level));
      meterRef.current?.setAttribute('aria-valuenow', String(Math.round(level * 100)));
    };
    paint(useTelemetryStore.getState().audioLevels[roleId]);
    return useTelemetryStore.subscribe(
      (state) => state.audioLevels[roleId],
      paint,
    );
  }, [roleId]);

  return (
    <div
      ref={meterRef}
      className="us-srcmic__meter"
      role="meter"
      aria-label="Lecturer microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(initial * 100)}
      style={{
        '--level': String(initial),
        gridTemplateColumns: `repeat(${segments}, 1fr)`,
      } as CSSProperties}
    >
      {Array.from({ length: segments }, (_, index) => (
        <span
          key={index}
          className="us-srcmic__seg"
          data-testid="level-segment"
          aria-hidden="true"
          style={{ '--threshold': String((index + 1) / segments) } as CSSProperties}
        />
      ))}
    </div>
  );
}
