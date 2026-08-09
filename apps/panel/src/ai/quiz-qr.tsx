import { create } from 'qrcode';

export interface QuizQrProps {
  readonly value: string;
  /** Rendered px size — S-20 C-5 sets the ≥ 240 px floor; callers must not go below it. */
  readonly size: number;
}

/** Modules of quiet-zone margin around the code (S-20 §4/§7). */
const QUIET_ZONE_MODULES = 4;

/**
 * W4-D-6/S20-D-3: a QR is a pure function of `value` — no client, no store, no
 * data source of any kind. `qrcode`'s `create()` is synchronous (no loading
 * state, S-20 §5.2); this renders its bit matrix as a hand-built SVG `<path>`
 * rather than reaching into the package's unexported renderer internals.
 * The plate is white in both themes (S20-D-8) — scannability is a contrast
 * requirement, not a style choice.
 */
export function QuizQr({ value, size }: QuizQrProps) {
  const qr = create(value, { errorCorrectionLevel: 'M' });
  const dimension = qr.modules.size;
  const viewBoxSize = dimension + QUIET_ZONE_MODULES * 2;

  const commands: string[] = [];
  for (let row = 0; row < dimension; row += 1) {
    for (let col = 0; col < dimension; col += 1) {
      if (qr.modules.get(row, col)) {
        commands.push(`M${col + QUIET_ZONE_MODULES},${row + QUIET_ZONE_MODULES}h1v1h-1z`);
      }
    }
  }

  return (
    <svg
      role="img"
      aria-label={`Join QR. Or go to ${value}.`}
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      shapeRendering="crispEdges"
    >
      <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
      <path d={commands.join(' ')} fill="#000000" />
    </svg>
  );
}
