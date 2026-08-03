import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
// Self-contained: OverlayHost owns .us-overlayhost's positioning rule, so it
// renders correctly even mounted standalone (e.g. in isolation in a test),
// not only when App.tsx's import of the same file happens to run first.
import '../styles/app.css';

export interface OverlayEntry {
  readonly id: number;
  readonly node: ReactNode;
  /** Set by the opener when the overlay must not be dismissed by the scrim. */
  readonly dismissible: boolean;
}

interface OverlayValue {
  readonly stack: readonly OverlayEntry[];
  open(node: ReactNode, options?: { dismissible?: boolean }): number;
  close(id: number): void;
  closeTop(): void;
}

const OverlayContext = createContext<OverlayValue | null>(null);

/**
 * The mount point and z-stack for every UI-local overlay (SI-D-2: overlays are
 * state, not URLs). A STACK, not a flag — S-15 opens on top of S-14.
 *
 * This is deliberately not a Modal: it owns mounting, ordering, the scrim and
 * Escape, and nothing else. Visual design lives in the screens (prompt 09).
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<OverlayEntry[]>([]);
  const nextId = useRef(1);

  const open = useCallback((node: ReactNode, options?: { dismissible?: boolean }) => {
    const id = nextId.current++;
    setStack((s) => [...s, { id, node, dismissible: options?.dismissible ?? true }]);
    return id;
  }, []);

  const close = useCallback((id: number) => {
    setStack((s) => s.filter((e) => e.id !== id));
  }, []);

  const closeTop = useCallback(() => {
    setStack((s) => (s.at(-1)?.dismissible === false ? s : s.slice(0, -1)));
  }, []);

  const value = useMemo(() => ({ stack, open, close, closeTop }), [stack, open, close, closeTop]);
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlays(): OverlayValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlays must be used inside <OverlayProvider>');
  return ctx;
}

/**
 * Renders the stack INSIDE .us-panel. No portal to document.body and no
 * position: fixed — frontend-conventions §3, and screen-inventory §8.3 requires
 * that a dialog opened from the dark .us-assistant scope render light, which
 * only holds if it mounts here rather than inside that scope.
 */
export function OverlayHost() {
  const { stack, closeTop } = useOverlays();
  return (
    <div
      className="us-overlayhost"
      data-testid="overlay-host"
      data-depth={stack.length}
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeTop();
      }}
    >
      {stack.map((entry, i) => (
        <div
          key={entry.id}
          className="us-overlayhost__layer"
          data-overlay-id={entry.id}
          style={{ zIndex: 100 + i }}
          role="presentation"
        >
          {entry.node}
        </div>
      ))}
    </div>
  );
}
