/** Shared by recording-row.tsx / selection-bar.tsx — the same figure, one place (INV-RP-1: never a guessed/hardcoded unit table). */
export function formatBytes(bytes: number): string {
  const units = bytes >= 1_000_000_000
    ? { divisor: 1_000_000_000, suffix: 'GB' }
    : { divisor: 1_000_000, suffix: 'MB' };
  const value = bytes / units.divisor;
  const digits = value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${digits} ${units.suffix}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}
