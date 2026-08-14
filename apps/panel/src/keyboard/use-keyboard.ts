import { useEffect, useRef, type FocusEvent } from 'react';
import { create } from 'zustand';

export type OskLayout = 'default' | 'numeric' | 'ip';

export interface OskFieldBinding {
  onFocus(event: FocusEvent<HTMLElement>): void;
  onBlur(): void;
  readonly 'data-osk': OskLayout;
}

interface Target {
  readonly id: number;
  value: string;
  onChange(next: string): void;
}

interface KeyboardState {
  open: boolean;
  layout: OskLayout;
  target: Target | null;
  focus(target: Target, layout: OskLayout): void;
  blurIfActive(id: number): void;
  updateIfActive(target: Target): void;
  close(): void;
  press(char: string): void;
  backspace(): void;
}

/**
 * Module-level store, deliberately not exported beyond this module and
 * KeyboardHost: it changes a few times per screen (frontend-conventions §1),
 * not per keystroke of telemetry, so it does not need the imperative
 * subscribe-and-paint treatment `telemetry-store.ts` requires.
 */
export const useKeyboardStore = create<KeyboardState>((set, get) => ({
  open: false,
  layout: 'default',
  target: null,

  focus(target, layout) {
    set({ open: true, layout, target });
  },

  // Guarded by id: when focus moves between two bound fields, the outgoing
  // field's blur and the incoming field's focus both fire synchronously
  // (browser order: blur then focus) before React ever re-renders, so the
  // store settles on the new target without an observable close (test 6).
  blurIfActive(id) {
    if (get().target?.id === id) set({ open: false, target: null });
  },

  // Registration keeps this current while the field stays focused: without
  // it, a field whose `onChange` closure was captured on the FIRST focus would
  // write every later keystroke back through a stale closure that no longer
  // matches the field's current value (frontend-conventions §1 mandates
  // imperative sync for exactly this reason).
  updateIfActive(target) {
    if (get().target?.id === target.id) set({ target });
  },

  close() {
    set({ open: false, target: null });
  },

  press(char) {
    const { target } = get();
    if (!target) return;
    target.onChange(target.value + char);
  },

  backspace() {
    const { target } = get();
    if (!target) return;
    target.onChange(target.value.slice(0, -1));
  },
}));

let nextFieldId = 1;

/** Binds one controlled text input to the single keyboard host. */
export function useOskField({
  value,
  onChange,
  layout = 'default',
}: {
  value: string;
  onChange(next: string): void;
  layout?: OskLayout;
}): OskFieldBinding {
  const id = useRef(nextFieldId++).current;
  const focus = useKeyboardStore((s) => s.focus);
  const blurIfActive = useKeyboardStore((s) => s.blurIfActive);
  const updateIfActive = useKeyboardStore((s) => s.updateIfActive);

  // Runs on every value/onChange change, NOT on every keyboard open/close —
  // this subscribes to nothing in the store (frontend-conventions §1: no
  // screen re-renders when the keyboard opens).
  useEffect(() => {
    updateIfActive({ id, value, onChange });
  }, [id, value, onChange, updateIfActive]);

  return {
    onFocus: (event: FocusEvent<HTMLElement>) => {
      focus({ id, value, onChange }, layout);
      // The keyboard opens as an absolute overlay across the bottom of the
      // panel; the browser has no idea it now covers the focused field, so it
      // never scrolls it into view on its own. Once `--osk-h` has been applied
      // (KeyboardHost sets it in a post-commit effect), nudge the field up so
      // it clears the keys. `scroll-margin-bottom` on the field (set in CSS to
      // the OSK height) is what actually reserves the clearance.
      const el = event.currentTarget;
      if (typeof el?.scrollIntoView === 'function') {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          });
        });
      }
    },
    onBlur: () => blurIfActive(id),
    'data-osk': layout,
  };
}
