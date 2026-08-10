import { useState } from 'react';

/** S-36 §4 — the ⧉ copy affordance: ≥ 44 px target, aria-live "Copied {label}" confirmation. */
export function CopyId({ value, label }: { readonly value: string; readonly label: string }): JSX.Element {
  const [announced, setAnnounced] = useState<string | null>(null);

  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => setAnnounced(`Copied ${label}`));
  };

  return (
    <>
      <button type="button" className="us-device__copy" onClick={copy} aria-label={`Copy ${label}`}>
        ⧉
      </button>
      <span className="us-visually-hidden" aria-live="polite">{announced}</span>
    </>
  );
}
