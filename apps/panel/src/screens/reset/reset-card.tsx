import type { ReactNode } from 'react';
import './reset.css';

/**
 * Presentation-only two-column card (S-02 §2, §4). No prototype coverage
 * exists for this screen — every value traces to S-02 §2/§7, nothing improvised.
 */
export function ResetCard({
  mode,
  headerAction,
  fields,
  reason,
  checklist,
  message,
  action,
}: {
  mode: 'forced' | 'voluntary';
  headerAction: ReactNode;
  fields: ReactNode;
  /** Rendered only when mode === 'forced'. */
  reason: ReactNode;
  checklist: ReactNode;
  message: ReactNode;
  action: ReactNode;
}): JSX.Element {
  return (
    <div className="us-reset">
      <div className="us-reset__card">
        <div className="us-reset__header">
          <h1 className="us-reset__title">Set a new password</h1>
          {headerAction}
        </div>
        <div className="us-reset__body">
          <div className="us-reset__col us-reset__col--left">
            {fields}
            {message}
          </div>
          <div className="us-reset__col us-reset__col--right">
            {mode === 'forced' && reason}
            {checklist}
            {action}
          </div>
        </div>
      </div>
    </div>
  );
}
