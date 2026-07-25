import { cn } from './cn'

interface ToggleProps {
  checked: boolean
  onChange: () => void
  label?: string
  disabled?: boolean
}

/** Large accessible on/off switch. */
export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn('us-toggle', checked && 'us-toggle--on', disabled && 'us-toggle--disabled')}
    >
      <span className="us-toggle__knob" />
    </button>
  )
}
