import { useId, useState } from 'react';
import type { Problem, StreamTarget, StreamTargetCreate, StreamTargetUpdate } from '@eduscope/shared';
import { useOskField } from '../../keyboard/use-keyboard.js';
import type { MutationPhase } from './use-stream-targets.js';
import './advanced.css';

const PLATFORMS: { readonly id: StreamTarget['platform']; readonly label: string }[] = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'custom-rtmp', label: 'Custom RTMP' },
];

export interface StreamTargetFormProps {
  /** `null` creates a new target; otherwise edits it — the key field always starts blank either way (INV-ST-1). */
  readonly target: StreamTarget | null;
  readonly phase: MutationPhase;
  readonly problem: Problem | null;
  onSave(body: StreamTargetCreate | StreamTargetUpdate): void;
  onCancel(): void;
}

/**
 * Three platform chips, display name, ingest URL, and a write-only key field
 * — it is never pre-filled and never masked to imply retrieval (INV-ST-1,
 * PF-17). Editing pre-fills name/URL, leaves the key empty, and sends
 * `streamKey` only when the operator typed a replacement.
 */
export function StreamTargetForm({ target, phase, problem, onSave, onCancel }: StreamTargetFormProps): JSX.Element {
  const [platform, setPlatform] = useState<StreamTarget['platform']>(target?.platform ?? 'youtube');
  const [displayName, setDisplayName] = useState(target?.displayName ?? '');
  const [ingestUrl, setIngestUrl] = useState(target?.ingestUrl ?? '');
  const [streamKey, setStreamKey] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);

  const displayNameOsk = useOskField({ value: displayName, onChange: setDisplayName });
  const ingestUrlOsk = useOskField({ value: ingestUrl, onChange: setIngestUrl });
  const streamKeyOsk = useOskField({ value: streamKey, onChange: setStreamKey });
  const streamKeyId = useId();
  const displayNameId = useId();
  const ingestUrlId = useId();

  const saving = phase === 'saving';
  const canSubmit = displayName.trim() !== '' && ingestUrl.trim() !== '' && (target !== null || streamKey.trim() !== '') && !saving;

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      // Clipboard denial stays inline and never clears an existing field.
      setStreamKey(text);
      setPasteError(null);
    } catch {
      setPasteError('Could not read the clipboard.');
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    if (target) {
      const body: StreamTargetUpdate = {
        platform, displayName, ingestUrl, ...(streamKey ? { streamKey } : {}),
      };
      onSave(body);
    } else {
      onSave({ platform, displayName, ingestUrl, streamKey } satisfies StreamTargetCreate);
    }
  };

  return (
    <form
      className="us-adm__card"
      data-testid="stream-target-form"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <div className="us-adm__platforms" role="group" aria-label="Platform">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`us-adm__platform${platform === p.id ? ' us-adm__platform--active' : ''}`}
            aria-pressed={platform === p.id}
            onClick={() => setPlatform(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="us-adm__grid2">
        <div className="us-adm__field">
          <label htmlFor={displayNameId}>Display name</label>
          <input
            id={displayNameId}
            className="us-input"
            aria-label="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onFocus={displayNameOsk.onFocus}
            onBlur={displayNameOsk.onBlur}
            data-osk={displayNameOsk['data-osk']}
          />
        </div>
        <div className="us-adm__field">
          <label htmlFor={ingestUrlId}>Ingest URL</label>
          <input
            id={ingestUrlId}
            className="us-input"
            aria-label="Ingest URL"
            value={ingestUrl}
            onChange={(e) => setIngestUrl(e.target.value)}
            onFocus={ingestUrlOsk.onFocus}
            onBlur={ingestUrlOsk.onBlur}
            data-osk={ingestUrlOsk['data-osk']}
          />
        </div>
      </div>

      <div className="us-adm__field">
        <label htmlFor={streamKeyId}>
          Stream key —{' '}
          {target?.hasStreamKey ? 'Configured' : 'Not configured'}
        </label>
        <div className="us-adm__inline">
          <input
            id={streamKeyId}
            className="us-input"
            type="password"
            autoComplete="off"
            placeholder="Enter a replacement key"
            aria-label={`Stream key — ${target?.hasStreamKey ? 'Configured' : 'Not configured'}`}
            value={streamKey}
            onChange={(e) => setStreamKey(e.target.value)}
            onFocus={streamKeyOsk.onFocus}
            onBlur={streamKeyOsk.onBlur}
            data-osk={streamKeyOsk['data-osk']}
          />
          <button type="button" className="us-adm__secondary" onClick={() => void handlePaste()}>
            Paste
          </button>
        </div>
        {pasteError && <span role="alert" className="us-presetgrid__status--error">{pasteError}</span>}
      </div>

      <div aria-live="polite" className="us-presetgrid__status">
        {phase === 'applied' && 'Saved.'}
      </div>
      <div aria-live="polite" className="us-presetgrid__status us-presetgrid__status--error">
        {phase === 'refused' && (problem?.title ?? 'This could not be saved.')}
      </div>

      <div className="us-adm__inline">
        <button type="button" className="us-adm__secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="us-adm__primary us-adm__primary--right" disabled={!canSubmit}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
