interface BitrateStepperProps {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (next: number) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
}

/** S-29 — ± steppers with a numeric readout, never a bare range; clamped to `capabilities.videoBitrateKbps`. */
export function BitrateStepper({ value, min, max, step = 250, onChange, disabled, invalid }: BitrateStepperProps): JSX.Element {
  return (
    <div className={`us-encoder__stepper${invalid ? ' us-encoder__stepper--invalid' : ''}`} role="group" aria-label="Video bitrate">
      <button
        type="button"
        aria-label="Decrease bitrate"
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - step))}
      >
        −
      </button>
      <span className="us-encoder__readout" data-testid="bitrate-readout">{value} kbps</span>
      <button
        type="button"
        aria-label="Increase bitrate"
        disabled={disabled}
        onClick={() => onChange(value + step)}
      >
        +
      </button>
      {(value < min || value > max) ? (
        <span className="us-encoder__range-hint">supported range: {min}–{max} kbps</span>
      ) : null}
    </div>
  );
}
