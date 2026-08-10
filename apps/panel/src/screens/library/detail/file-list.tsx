import type { Recording, RecordingFile } from '@eduscope/shared';
import { useClient } from '../../../client/client-provider.js';
import { formatBytes, formatDuration } from '../format.js';
import './detail.css';

/** S-22 §2.1 — downloadable deliverables. Download targets THIS browser (§7 touch note); the USB path is S-23. */
export function FileList({
  recordingId,
  files,
}: {
  readonly recordingId: Recording['id'];
  readonly files: readonly RecordingFile[];
}): JSX.Element {
  const client = useClient();

  const download = async (file: RecordingFile) => {
    const blob = await client.getRecordingMedia(recordingId, file.id, { download: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.streamKey}.${file.container}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="us-detail__files">
      <h2>Files</h2>
      <ul>
        {files.map((file) => (
          <li key={file.id} className="us-detail__file-row">
            <span>
              {file.streamKey} · {file.container} · {file.sizeBytes !== null ? formatBytes(file.sizeBytes) : '—'}
              {' · '}
              {file.durationMs !== null ? formatDuration(file.durationMs) : '—'}
              {' · '}
              {file.hasAudio ? 'with audio' : 'no audio'}
            </span>
            <button type="button" onClick={() => void download(file)} disabled={file.state === 'missing'}>
              Download ⤓
            </button>
          </li>
        ))}
      </ul>
      <p className="us-detail__download-hint">
        Download saves to this browser. To copy to a USB drive, use Copy to USB.
      </p>
    </div>
  );
}
