import { useEffect, useRef } from 'react';
import type { SourceRoleId } from '@eduscope/shared';
import { useOverlays } from '../../overlays/overlay-host.js';
import { usePreview } from './use-preview.js';
import './sources.css';

export function PreviewLightbox({
  roleId,
  label,
}: {
  readonly roleId: SourceRoleId;
  readonly label: string;
}): JSX.Element {
  const overlays = useOverlays();
  const preview = usePreview(roleId);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => closeRef.current?.focus(), []);

  const dismiss = () => {
    preview.close();
    overlays.closeTop();
  };

  return (
    <div className="us-previewroot" role="presentation">
      <button
        type="button"
        className="us-previewroot__scrim"
        aria-label="Dismiss preview"
        tabIndex={-1}
        onClick={dismiss}
      />
      <section
        className="us-previewlightbox"
        role="dialog"
        aria-modal="true"
        aria-label={`${label} preview`}
      >
        <header className="us-previewlightbox__head">
          <div>
            <h2>{label}</h2>
            <p>Live preview</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="us-previewlightbox__close"
            aria-label="Close preview"
            onClick={dismiss}
          >×</button>
        </header>
        <div className="us-previewlightbox__body">
          {preview.state.kind === 'negotiating' ? (
            <div className="us-previewlightbox__frame us-previewlightbox__skeleton" data-testid="preview-skeleton" />
          ) : preview.state.kind === 'live' ? (
            <div className="us-previewlightbox__frame us-previewlightbox__live">
              {preview.state.frame ? (
                <img src={preview.state.frame} alt="" data-testid="preview-frame" />
              ) : (
                <div className="us-previewlightbox__framefill" data-testid="preview-frame-placeholder" />
              )}
              <span className="us-previewlightbox__chip">
                <span className="us-previewlightbox__dot" aria-hidden="true" /> LIVE
              </span>
            </div>
          ) : preview.state.kind === 'failed' ? (
            <div className="us-previewlightbox__frame us-previewlightbox__message" role="status">
              {preview.state.message}
            </div>
          ) : (
            <div className="us-previewlightbox__frame us-previewlightbox__message" role="status">
              {preview.state.reason === 'disconnected' ? 'The preview disconnected.' : 'Preview closed.'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
