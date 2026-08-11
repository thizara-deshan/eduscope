import * as React from 'react';
import { cn } from '../../lib/utils.js';

/** text-base keeps the field at 16px so iOS does not zoom on focus (screen-inventory §6). */
export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  function Input({ className, type = 'text', ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'flex h-12 w-full rounded-xl border border-border bg-surface px-4 text-base text-text shadow-sm',
          'transition-colors placeholder:text-muted',
          'focus-visible:border-primary aria-[invalid=true]:border-danger',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...props}
      />
    );
  },
);
