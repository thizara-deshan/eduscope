import './toggle-switch.css';

export interface ToggleSwitchProps {
  readonly checked: boolean | undefined;
  readonly label: string;
  readonly disabled?: boolean;
  readonly failed?: boolean;
  readonly describedBy?: string;
  readonly onChange: (checked: boolean) => void;
}

export function ToggleSwitch({
  checked,
  label,
  disabled,
  failed,
  describedBy,
  onChange,
}: ToggleSwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className="us-switch"
      data-failed={failed || undefined}
      onClick={() => {
        if (checked !== undefined) onChange(!checked);
      }}
    >
      <span className="us-switch__track" aria-hidden="true">
        <span className="us-switch__thumb" />
      </span>
    </button>
  );
}
