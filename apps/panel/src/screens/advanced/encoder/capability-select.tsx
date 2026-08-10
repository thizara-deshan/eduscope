interface CapabilitySelectProps {
  readonly label: string;
  readonly value: number | string;
  readonly options: readonly (number | string)[];
  readonly onChange: (next: number | string) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
}

/** S-29 — renders ONLY capabilities-listed options (B-56); an unsupported value is absent, not disabled. */
export function CapabilitySelect({ label, value, options, onChange, disabled, invalid }: CapabilitySelectProps): JSX.Element {
  const isNumeric = typeof options[0] === 'number';
  return (
    <label className="us-encoder__field">
      <span className="us-device__label">{label}</span>
      <select
        className={`us-encoder__select${invalid ? ' us-encoder__select--invalid' : ''}`}
        value={String(value)}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(isNumeric ? Number(e.target.value) : e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </label>
  );
}
