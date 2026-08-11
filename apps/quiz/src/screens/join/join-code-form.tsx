import { useId, type FormEvent } from 'react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>Quiz code</Label>
        <Input
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
          placeholder="ABC123"
          className="h-14 text-center text-2xl font-bold uppercase tracking-[0.3em] placeholder:tracking-[0.3em] placeholder:font-normal placeholder:normal-case"
        />
      </div>
      <Button type="submit" size="block" disabled={disabled || code.trim().length === 0}>
        Join
      </Button>
    </form>
  );
}
