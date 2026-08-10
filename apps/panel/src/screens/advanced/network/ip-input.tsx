import { useOskField } from '../../../keyboard/use-keyboard.js';

interface IpInputProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly disabled?: boolean;
}

function IpOctetInput({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean | undefined;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  const binding = useOskField({ value, onChange, layout: 'ip' });

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      className="us-network__octet"
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      {...binding}
    />
  );
}

/** S-28 — four octet-segmented numeric fields; no free-text entry. */
export function IpInput({ label, value, onChange, disabled }: IpInputProps): JSX.Element {
  const octets = value.split('.');
  while (octets.length < 4) octets.push('');

  const setOctet = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 3);
    const next = [...octets];
    next[index] = digits;
    onChange(next.join('.'));
  };

  return (
    <div className="us-network__ipinput" role="group" aria-label={label}>
      {octets.map((octet, i) => (
        <span key={`octet-${i}`} className="us-network__octetwrap">
          <IpOctetInput
            value={octet}
            disabled={disabled}
            label={`${label} octet ${i + 1}`}
            onChange={(next) => setOctet(i, next)}
          />
          {i < 3 ? <span aria-hidden="true">.</span> : null}
        </span>
      ))}
    </div>
  );
}
