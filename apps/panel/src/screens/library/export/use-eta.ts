/** S-23 EXP-D-3 — the ETA is a pure function of transfer bytes over time. No client, no store, no `freeBytes`. */
export interface EtaSample {
  readonly bytesCopied: number;
  /** ms epoch */
  readonly at: number;
}

/** Seconds remaining, smoothed over recent samples; null before enough samples. */
export function computeEta(bytesTotal: number, samples: readonly EtaSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const elapsedMs = last.at - first.at;
  const bytesDelta = last.bytesCopied - first.bytesCopied;
  if (elapsedMs <= 0 || bytesDelta <= 0) return null;

  const bytesPerMs = bytesDelta / elapsedMs;
  const remainingBytes = bytesTotal - last.bytesCopied;
  if (remainingBytes <= 0) return 0;

  return Math.round(remainingBytes / bytesPerMs / 1000);
}
