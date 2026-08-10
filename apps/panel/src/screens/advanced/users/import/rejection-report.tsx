import type { UserImportBatch } from '@eduscope/shared';

/** S-33 headline surface — a scrollable row -> reason table + "Nothing was imported." No partial writes. */
export function RejectionReport({ batch }: { readonly batch: UserImportBatch }): JSX.Element {
  return (
    <div className="us-import__rejection">
      <p className="us-device__missing" data-testid="rejection-headline">Nothing was imported.</p>
      <div className="us-import__rejectiontable" role="table" aria-label="Rejected rows">
        <div role="row" className="us-import__rejectionrow us-import__rejectionrow--head">
          <span role="columnheader">Row</span>
          <span role="columnheader">Column</span>
          <span role="columnheader">Reason</span>
        </div>
        {batch.rejections.map((r, i) => (
          <div role="row" className="us-import__rejectionrow" key={`row${r.row}-col${r.column}-${i}`}>
            <span role="cell">{r.row}</span>
            <span role="cell">{r.column}</span>
            <span role="cell">{r.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
