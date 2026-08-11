import { forwardRef, type InputHTMLAttributes } from 'react';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { FieldProblem } from './field-problem.js';

interface PolicyFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

export const PolicyField = forwardRef<HTMLInputElement, PolicyFieldProps>(function PolicyField(
  { label, hint, error, id, ...rest },
  ref,
) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        ref={ref}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <FieldProblem id={errorId ?? `${id}-error`} message={error} />
    </div>
  );
});
