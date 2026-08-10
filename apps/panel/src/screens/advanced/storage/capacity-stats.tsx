interface CapacityStatsProps {
  readonly totalBytes: number;
  readonly freeBytes: number;
  readonly pressure: 'ok' | 'warning' | 'critical';
}

function formatBytes(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${gb.toFixed(0)} GB`;
}

const PRESSURE_COPY: Record<CapacityStatsProps['pressure'], string> = {
  ok: 'ok', warning: 'warning', critical: 'critical',
};

/** S-30 — total/free/used% + pressure, always with a word next to the dot. */
export function CapacityStats({ totalBytes, freeBytes, pressure }: CapacityStatsProps): JSX.Element {
  const usedPct = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0;
  return (
    <div className="us-device__field" aria-label="Capacity">
      <span className={`us-device__dot us-device__dot--${pressure === 'ok' ? 'on' : pressure === 'warning' ? 'warning' : 'danger'}`} aria-hidden="true" />
      <span className="us-device__value">Pressure: {PRESSURE_COPY[pressure]}</span>
      <span className="us-device__value">{formatBytes(freeBytes)} free of {formatBytes(totalBytes)} ({usedPct}% used)</span>
    </div>
  );
}
