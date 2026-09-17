import { useLayoutEffect, useRef } from 'react';
import type { SourceRoleId } from '@eduscope/shared';

export type PreviewFrame = string | ImageBitmap;

/**
 * Live previews use ImageBitmap so each superseded full-HD decode can be
 * explicitly closed. Canvas also keeps only a small, viewport-sized backing
 * buffer instead of leaving browser image-cache entries behind every second.
 * String frames remain supported for static/mock layout previews.
 */
export function PreviewFrameImage({
  frame,
  className,
  roleId,
  testId,
}: {
  readonly frame: PreviewFrame;
  readonly className: string;
  readonly roleId?: SourceRoleId;
  readonly testId?: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    if (typeof frame === 'string') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
    canvas.getContext('2d')?.drawImage(frame, 0, 0, canvas.width, canvas.height);
  }, [frame]);

  if (typeof frame === 'string') {
    return <img className={className} src={frame} alt="" data-role={roleId} data-testid={testId} />;
  }
  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      data-role={roleId}
      data-testid={testId}
    />
  );
}
