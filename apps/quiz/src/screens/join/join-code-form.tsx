import { useId, type FormEvent } from 'react';

const MAX_LENGTH = 32;

export function JoinCodeForm({
  code,
  onChange,
  onSubmit,
  disabled,
}: {
  code: string;
  onChange: (code: string) => void;
  onSubmit: (code: string) => void;
  disabled: boolean;
}) {
  const inputId = useId();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(code);
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor={inputId}>Quiz code</label>
      <input
        id={inputId}
        name="joinCode"
        type="text"
        aria-label="Quiz code"
        value={code}
        onChange={(event) => onChange(event.target.value)}
        maxLength={MAX_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || code.trim().length === 0}>
        Join
      </button>
    </form>
  );
}
