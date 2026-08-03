import { useCallback, useRef } from 'react';

/** Pointer-only; no hover, no keyboard shortcut — this is a touch kiosk. */
export function useLongPress(ms: number, onTrigger: () => void) {
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const start = useCallback(() => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onTrigger();
    }, ms);
  }, [cancel, ms, onTrigger]);

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  };
}
