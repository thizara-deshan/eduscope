import { useRef, useState } from 'react';

interface FilePickerProps {
  readonly onFile: (file: File) => void;
  readonly disabled: boolean;
}

/** S-33 — required-columns statement; client-side wrong-file-type reject before any upload. */
export function FilePicker({ onFile, disabled }: FilePickerProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  const handleChange = () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      setRejected(`"${file.name}" is not a .xlsx file.`);
      return;
    }
    setRejected(null);
    onFile(file);
  };

  return (
    <div className="us-import__picker">
      <p className="us-adm__note">
        Required columns: username, displayName, role. One user per row.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        aria-label="Choose roster file"
        disabled={disabled}
        onChange={handleChange}
      />
      {rejected ? <p className="us-device__missing">{rejected}</p> : null}
    </div>
  );
}
