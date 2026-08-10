import { FilePicker } from './file-picker.js';
import { RejectionReport } from './rejection-report.js';
import { useImport } from './use-import.js';
import { useIsStale } from '../../../../store/selectors.js';
import './import.css';

interface BulkImportOverlayProps {
  readonly onClose: () => void;
}

/** S-33 — overlay on S-32; whole-batch validation (B-44): any invalid row rejects the entire batch. */
export function BulkImportOverlay({ onClose }: BulkImportOverlayProps): JSX.Element {
  const { batch, uploading, upload, reset } = useImport();
  const stale = useIsStale();

  return (
    <div className="us-dangerconfirm__scrim" role="presentation">
      <div className="us-dangerconfirm us-import" role="dialog" aria-label="Bulk import users">
        <h2>Bulk import users</h2>

        {!batch ? (
          <>
            <FilePicker onFile={upload} disabled={uploading || stale} />
            {uploading ? <p className="us-adm__note" data-testid="import-uploading">Uploading…</p> : null}
          </>
        ) : batch.state === 'applied' ? (
          <p className="us-import__accepted" data-testid="import-accepted">
            {batch.acceptedCount} user{batch.acceptedCount === 1 ? '' : 's'} created, all flagged to reset their password on first login.
          </p>
        ) : (
          <RejectionReport batch={batch} />
        )}

        <footer className="us-dangerconfirm__footer">
          <button type="button" className="us-dangerconfirm__cancel" onClick={onClose}>Close</button>
          {batch && batch.state === 'rejected' ? (
            <button type="button" className="us-adm__secondary" onClick={reset}>Try another file</button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
