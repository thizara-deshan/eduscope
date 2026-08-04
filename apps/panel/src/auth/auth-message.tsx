import './auth.css';

export type AuthMessageValue =
  | { kind: 'error'; text: string }
  | { kind: 'warning'; text: string }
  | { kind: 'info'; text: string }
  | null;

/**
 * Fixed 40px, rendered unconditionally from first paint (S01-D-4): a slot
 * that mounted on demand would move a 56px submit button under a reaching
 * finger at the exact moment a lecturer needs it (S-01 §2.1).
 */
export function AuthMessage({ value }: { value: AuthMessageValue }): JSX.Element {
  const className = value ? `us-authmsg us-authmsg--${value.kind}` : 'us-authmsg';
  return (
    <div className={className} data-testid="auth-message" aria-live="polite">
      {value?.text ?? ''}
    </div>
  );
}
