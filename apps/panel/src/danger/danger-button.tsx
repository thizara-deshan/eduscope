import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './danger.css';

export type DangerVariant = 'quiet' | 'solid';

export interface DangerButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant: DangerVariant;
  readonly children: ReactNode;
}

export function DangerButton({ variant, children, type = 'button', ...props }: DangerButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={`us-dangerbutton us-dangerbutton--${variant}`}
    >
      {children}
    </button>
  );
}
