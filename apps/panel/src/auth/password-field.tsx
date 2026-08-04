import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { useOskField } from '../keyboard/use-keyboard.js';
import './auth.css';

/** Reveal is explicit and transient (S-02 §8): it is never left on. */
const REVEAL_TIMEOUT_MS = 10_000;

export function PasswordField({
  label,
  value,
  onChange,
  reveal = false,
  disabled = false,
  inputRef,
  describedById,
}: {
  label: string;
  value: string;
  onChange(next: string): void;
  /** S02-D-4: true on S-02's New password ONLY. Never on S-01. */
  reveal?: boolean;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  describedById?: string;
}): JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const binding = useOskField({ value, onChange, layout: 'default' });
  const inputId = useId();

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  function toggleReveal(): void {
    setRevealed((r) => {
      const next = !r;
      clearTimeout(hideTimer.current);
      if (next) {
        hideTimer.current = setTimeout(() => setRevealed(false), REVEAL_TIMEOUT_MS);
      }
      return next;
    });
  }

  return (
    <div className="us-field">
      <label className="us-field__label" htmlFor={inputId}>{label}</label>
      <div className="us-field__row">
        <input
          ref={inputRef}
          id={inputId}
          className="us-input"
          type={reveal && revealed ? 'text' : 'password'}
          autoComplete="off"
          name="us-password-field"
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-describedby={describedById}
          onChange={(e) => onChange(e.target.value)}
          onFocus={binding.onFocus}
          onBlur={() => {
            binding.onBlur();
            clearTimeout(hideTimer.current);
            setRevealed(false);
          }}
          data-osk={binding['data-osk']}
        />
        {reveal && (
          <button
            type="button"
            className="us-field__reveal"
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            disabled={disabled}
            onClick={toggleReveal}
          >
            {revealed ? '🙈' : '👁'}
          </button>
        )}
      </div>
    </div>
  );
}
