import { useState } from 'react';
import { useOskField } from '../../../keyboard/use-keyboard.js';

interface RegisterDriveFormProps {
  readonly onRegister: (uuid: string, label: string) => void;
  readonly registering: boolean;
  readonly error: string | null;
  readonly disabled: boolean;
}

export function RegisterDriveForm({ onRegister, registering, error, disabled }: RegisterDriveFormProps): JSX.Element {
  const [uuid, setUuid] = useState('');
  const [label, setLabel] = useState('');
  const uuidBinding = useOskField({ value: uuid, onChange: setUuid });
  const labelBinding = useOskField({ value: label, onChange: setLabel });

  return (
    <section className="us-adm__card us-storage__card" aria-label="Register drive">
      <h2 className="us-device__eyebrow">Register a drive</h2>
      <label className="us-device__field">
        <span className="us-device__label">Volume UUID</span>
        <input
          type="text"
          value={uuid}
          onChange={(e) => setUuid(e.target.value)}
          aria-label="Volume UUID"
          {...uuidBinding}
        />
      </label>
      <label className="us-device__field">
        <span className="us-device__label">Label (optional)</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="Volume label"
          {...labelBinding}
        />
      </label>
      {error ? <p className="us-device__missing">{error}</p> : null}
      <button
        type="button"
        className="us-adm__primary"
        disabled={!uuid || registering || disabled}
        onClick={() => onRegister(uuid, label)}
      >
        {registering ? 'Registering…' : 'Register'}
      </button>
    </section>
  );
}
