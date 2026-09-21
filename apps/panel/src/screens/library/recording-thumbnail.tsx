import { memo, useEffect, useRef, useState } from 'react';
import type { Ulid } from '@eduscope/shared';
import { useClient } from '../../client/client-provider.js';

/** Fetches only near-visible rows and releases blob URLs when a row leaves the tree. */
export const RecordingThumbnail = memo(function RecordingThumbnail({ recordingId }: { readonly recordingId: Ulid }): JSX.Element {
  const client = useClient();
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void client.getRecordingThumbnail(recordingId).then((blob) => {
      if (cancelled || blob.size === 0) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => {
      // A recording may still be finalizing or may not contain video. Keep the
      // quiet placeholder; a later mount/refresh gets another opportunity.
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, recordingId, visible]);

  return (
    <span ref={hostRef} className="us-reclist__thumb" aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : <span className="us-reclist__thumb-placeholder">▶</span>}
    </span>
  );
});
