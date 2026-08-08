import { useEffect, useRef, useState } from 'react';
import { CaptureDiskRow } from './capture-disk-row.js';
import { CaptureOutputsRow } from './capture-outputs-row.js';
import { CaptureSourcesRow } from './capture-sources-row.js';
import { CaptureVerdict } from './capture-verdict.js';

export function CaptureAssuranceCard(): JSX.Element {
  const cardRef = useRef<HTMLElement>(null);
  const [dense, setDense] = useState(false);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    const applyHeight = (height: number) => {
      if (height > 0) setDense(height < 480);
    };
    applyHeight(card.getBoundingClientRect().height);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) applyHeight(entry.contentRect.height);
    });
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={cardRef}
      className={`us-capturecard${dense ? ' us-capturecard--dense' : ''}`}
      data-testid="capture-assurance-card"
      data-density={dense ? 'dense' : 'comfortable'}
      aria-label="Capture assurance"
    >
      <CaptureVerdict />
      <CaptureSourcesRow dense={dense} />
      <CaptureOutputsRow dense={dense} />
      <CaptureDiskRow dense={dense} />
    </section>
  );
}
