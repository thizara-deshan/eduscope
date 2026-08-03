import type { SourceRoleId } from '@eduscope/shared';
import type { MockWorld } from '../world.js';

/** events.md §2.6/§5: throttled to <= 10 Hz. */
const LEVELS_HZ = 10;
const LEVELS_PERIOD_MS = 1_000 / LEVELS_HZ;

/**
 * Mic level telemetry.
 *
 * Deliberately NOT the prototype's `useMicLevels` random walk — that is
 * prototype-only (frontend-conventions §2). The panel binds to this event, and
 * this event obeys the contract's frequency budget: the kiosk browser shares an
 * RK3588 with the capture pipelines, so 10 Hz is a hard ceiling, not a target.
 */
export function startAudioLevels(
  world: MockWorld,
  roleIds: readonly SourceRoleId[],
): () => void {
  let stopped = false;
  let tick = 0;

  const step = () => {
    if (stopped) return;
    // Suppress entirely when no panel is subscribed (events.md §2.6).
    if (world.subscriberCount() > 0) {
      for (const roleId of roleIds) {
        // Speech-shaped envelope: a slow syllabic rise/fall plus jitter, clamped.
        const phase = (tick % 24) / 24;
        const envelope = 0.18 + 0.55 * Math.sin(Math.PI * phase) ** 2;
        const jitter = ((tick * 2654435761) % 1000) / 10000; // deterministic
        world.emit('audio.levels', {
          roleId,
          rms: Math.min(1, Math.max(0, envelope + jitter - 0.05)),
        });
      }
    }
    tick += 1;
    world.clock.setTimeout(step, LEVELS_PERIOD_MS);
  };

  world.clock.setTimeout(step, LEVELS_PERIOD_MS);
  return () => {
    stopped = true;
  };
}

/** A 1x1 baseline JPEG — SOI ffd8 … EOI ffd9. Used where no canvas exists. */
const FALLBACK_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/**
 * A fake preview frame as a JPEG data URI.
 *
 * In a browser this paints a labelled, moving test card on a canvas and encodes
 * it — that is where previews actually render, and a moving frame is what proves
 * the lightbox is live rather than frozen (S-10's `live` vs `negotiating`).
 * Under Node (vitest) there is no canvas, so a constant baseline JPEG is
 * returned with the sequence number appended to the URI fragment so successive
 * frames still differ.
 */
const FRAME_W = 480;
const FRAME_H = 270;

/** One canvas for the life of the module — never one per frame (see the note). */
let frameCanvas: HTMLCanvasElement | null = null;

export function generateFrame(roleId: SourceRoleId, seq: number): string {
  if (typeof document === 'undefined') {
    return `data:image/jpeg;base64,${FALLBACK_JPEG_BASE64}#${seq}`;
  }
  if (!frameCanvas) {
    frameCanvas = document.createElement('canvas');
    frameCanvas.width = FRAME_W;
    frameCanvas.height = FRAME_H;
  }
  const ctx = frameCanvas.getContext('2d');
  if (!ctx) return `data:image/jpeg;base64,${FALLBACK_JPEG_BASE64}#${seq}`;

  ctx.fillStyle = '#242a35'; // --ink-3
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.fillStyle = '#2f6bed'; // --accent
  ctx.fillRect((seq * 7) % (FRAME_W - 40), 120, 40, 60);
  ctx.fillStyle = '#f2f4f8'; // --on-ink
  ctx.font = '16px system-ui';
  ctx.fillText(`${roleId} · mock preview · frame ${seq}`, 16, 32);
  return frameCanvas.toDataURL('image/jpeg', 0.5);
}
