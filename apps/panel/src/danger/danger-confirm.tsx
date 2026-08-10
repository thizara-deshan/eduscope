import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { DangerButton } from './danger-button.js';
import './danger.css';

/** DGR-D-4 — the only four states any DangerConfirm in this product has. */
export type DangerConfirmState = 'confirm' | 'pending' | 'refused' | 'done';

export interface DangerConfirmProps {
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly pendingLabel: string;
  readonly state: DangerConfirmState;
  readonly message?: ReactNode;
  readonly remedy?: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly cancelLabel?: string;
  /** U-2: disable the destructive action while disconnected — a tap must not queue and fire on reconnect. Cancel/label are unaffected. */
  readonly confirmDisabled?: boolean;
}

export function DangerConfirm({
  title,
  body,
  confirmLabel,
  pendingLabel,
  state,
  message,
  remedy,
  onCancel,
  onConfirm,
  cancelLabel = 'Cancel',
  confirmDisabled = false,
}: DangerConfirmProps): JSX.Element | null {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, [state]);

  if (state === 'done') return null;

  const pending = state === 'pending';

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="us-dangerconfirm__scrim" role="presentation">
      <div
        ref={dialogRef}
        className="us-dangerconfirm"
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={trapFocus}
      >
        <h2 id={titleId}>{title}</h2>
        <div id={bodyId} className="us-dangerconfirm__body">{body}</div>
        <div
          className="us-dangerconfirm__message"
          data-testid="danger-message"
          aria-live="polite"
        >
          {message}
        </div>
        <footer className="us-dangerconfirm__footer">
          <button
            ref={cancelRef}
            type="button"
            className="us-dangerconfirm__cancel"
            disabled={pending}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          {state === 'refused' ? remedy : (
            <DangerButton
              variant="solid"
              disabled={pending || confirmDisabled}
              onClick={onConfirm}
            >
              {pending ? pendingLabel : confirmLabel}
            </DangerButton>
          )}
        </footer>
      </div>
    </div>
  );
}
