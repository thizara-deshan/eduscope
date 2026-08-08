import { useEffect, useState } from 'react';
import type { StreamTarget, Ulid } from '@eduscope/shared';
import { useAuth } from '../../auth/auth-context.js';
import { LayoutPresetPicker } from '../../channels/layout-preset-picker.js';
import { LayoutPreview } from '../../channels/layout-preview.js';
import { useChannelConfig } from '../../channels/use-channel-config.js';
import { DangerConfirm } from '../../danger/danger-confirm.js';
import { useOverlays } from '../../overlays/overlay-host.js';
import { StreamTargetForm } from './stream-target-form.js';
import { StreamTargetList } from './stream-target-list.js';
import { useStreamingChannel } from './use-streaming-channel.js';
import { useStreamTargets } from './use-stream-targets.js';
import './advanced.css';

function stateWord(state: string | undefined, reason: string | null | undefined): string {
  switch (state) {
    case 'on': return 'On';
    case 'preflight': return 'Checking your destination…';
    case 'starting': return reason ? 'Restarting…' : 'Starting…';
    case 'stopping': return 'Turning off…';
    case 'failed': return reason ?? 'Failed to start.';
    case 'off':
    default:
      return 'Off';
  }
}

/**
 * S-27 — channel on/off, layout preset, and (admin) stream-target
 * credentials. Reachable by both roles; only target CRUD is admin-only
 * (W3-D-2). Idle writes `enabledByDefault`; a live session issues real
 * channel commands — two different actions behind one control (contract C-4).
 */
export function StreamingScreen(): JSX.Element {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const overlays = useOverlays();
  const streaming = useStreamingChannel();
  const targets = useStreamTargets();
  const streamTargetsConfigMutation = useChannelConfig('streaming');
  const [editingTarget, setEditingTarget] = useState<StreamTarget | null | 'new'>(null);

  // Close the form only once the save actually succeeds — a rejected save
  // (U-5) must leave the form open with the named reason visible.
  useEffect(() => {
    if (editingTarget !== null && targets.phase === 'applied') {
      setEditingTarget(null);
      targets.reset();
    }
  }, [editingTarget, targets, targets.phase]);

  if (streaming.loading || !streaming.config) {
    return <section className="us-adm__card" data-testid="screen" data-screen="S-27"><div data-testid="streaming-screen-skeleton" /></section>;
  }

  const status = streaming.status;
  const isFailed = status?.state === 'failed';
  const selectedPreset = streaming.options.find((o) => o.preset.id === streaming.config?.presetId)?.preset;
  const configuredCount = streaming.config.streamTargetIds?.length ?? 0;

  const closeForm = () => { setEditingTarget(null); targets.reset(); };
  const saveTarget = (body: Parameters<typeof targets.create>[0] | Parameters<typeof targets.update>[1]) => {
    if (editingTarget && editingTarget !== 'new') {
      targets.update(editingTarget.id, body);
    } else {
      targets.create(body as Parameters<typeof targets.create>[0]);
    }
  };

  const requestDelete = (target: StreamTarget) => {
    const close = () => {
      const id = overlays.stack.at(-1)?.id;
      if (id !== undefined) overlays.close(id);
    };
    const confirmDelete = () => {
      const targetId: Ulid = target.id;
      targets.remove(targetId);
      const nextIds = (streaming.config?.streamTargetIds ?? []).filter((id) => id !== targetId);
      streamTargetsConfigMutation.save({ streamTargetIds: nextIds });
      close();
    };
    overlays.open(
      <DangerConfirm
        title={`Delete ${target.displayName}?`}
        body={<p>This removes the saved destination. This can&rsquo;t be undone.</p>}
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        state="confirm"
        onCancel={close}
        onConfirm={confirmDelete}
      />,
    );
  };

  return (
    <>
      <section className="us-adm__card" data-testid="screen" data-screen="S-27">
        <div className="us-adm__streamhead">
          <div>
            <h2 className="us-adm__cardtitle">Streaming Configuration</h2>
            <p className="us-adm__note" data-testid="streaming-state-word">
              {streaming.mode === 'live' ? stateWord(status?.state, status?.reason) : (streaming.checked ? 'Will start streaming with the next recording.' : 'Off.')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={streaming.checked}
            aria-label={streaming.toggleLabel}
            disabled={streaming.toggleDisabled}
            onClick={streaming.toggle}
            className={`us-toggle${streaming.checked ? ' us-toggle--on' : ''}${isFailed ? ' us-toggle--failed' : ''}`}
          >
            <span className="us-toggle__knob" />
          </button>
        </div>
        <p className="us-adm__note">{streaming.toggleLabel}</p>

        <div className="us-adm__streamlayout">
          <div className="us-adm__streampreview">
            <span className="us-adm__field">
              <span>Layout preview{selectedPreset ? ` · ${selectedPreset.displayName}` : ''}</span>
            </span>
            {selectedPreset && <LayoutPreview preset={selectedPreset} large />}
          </div>
          <LayoutPresetPicker
            options={streaming.options}
            config={streaming.config}
            phase={streaming.presetPhase}
            problem={streaming.presetProblem}
            pendingPresetId={streaming.pendingPresetId}
            onSelect={streaming.selectPreset}
          />
        </div>
      </section>

      {isAdmin ? (
        <>
          <section className="us-adm__card">
            <h2 className="us-adm__cardtitle us-adm__cardtitle--small">Saved streaming destinations</h2>
            <StreamTargetList
              targets={targets.targets}
              onEdit={(t) => setEditingTarget(t)}
              onDeleteClick={requestDelete}
            />
            {editingTarget === null && (
              <button type="button" className="us-adm__primary" onClick={() => setEditingTarget('new')}>
                Add destination
              </button>
            )}
          </section>

          {editingTarget !== null && (
            <StreamTargetForm
              target={editingTarget === 'new' ? null : editingTarget}
              phase={targets.phase}
              problem={targets.problem}
              onSave={saveTarget}
              onCancel={closeForm}
            />
          )}
        </>
      ) : (
        <section className="us-adm__card">
          <h2 className="us-adm__cardtitle us-adm__cardtitle--small">Streaming destinations</h2>
          <p className="us-adm__note" data-testid="streaming-target-count">
            {configuredCount} destination{configuredCount === 1 ? '' : 's'} configured. An administrator manages credentials.
          </p>
        </section>
      )}
    </>
  );
}
