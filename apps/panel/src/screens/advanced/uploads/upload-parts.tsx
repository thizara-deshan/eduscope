import { useQuery } from '@tanstack/react-query';
import { useClient } from '../../../client/client-provider.js';
import { useUploadPartEvents } from '../../../store/selectors.js';
import { formatBytes } from '../../library/format.js';
import { UPLOAD_KEYS } from './query-keys.js';
import './uploads.css';

/** S-35 §5.1 — `getUploadJob` parts merged live with `upload.part`. Read-only (C-2); a `missing` part names the dead-letter cause. */
export function UploadParts({ jobId }: { readonly jobId: string }): JSX.Element {
  const client = useClient();
  const partEvents = useUploadPartEvents();

  const query = useQuery({
    queryKey: UPLOAD_KEYS.job(jobId),
    queryFn: () => client.getUploadJob(jobId),
  });

  if (query.isPending) {
    return <div className="us-uploadparts" data-testid="upload-parts-skeleton" />;
  }

  const parts = (query.data?.parts ?? []).map((part) => {
    const delta = partEvents[part.id];
    return delta ? { ...part, state: delta.state, bytesSent: delta.bytesSent, bytesTotal: delta.bytesTotal } : part;
  });

  return (
    <ul className="us-uploadparts">
      {parts.map((part) => (
        <li key={part.id} className="us-uploadparts__row">
          <span>{part.streamKey}</span>
          <span>{formatBytes(part.bytesSent)} of {formatBytes(part.bytesTotal)}</span>
          {part.state === 'missing' ? <span className="us-uploadparts__missing">✕ file missing</span> : null}
        </li>
      ))}
    </ul>
  );
}
