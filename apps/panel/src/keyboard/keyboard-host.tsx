import { useEffect, useRef, useState } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import './keyboard.css';
import { useKeyboardStore } from './use-keyboard.js';

/** The reserve S-01 §2's height budget is built on. Exported so tests and CSS cannot drift apart. */
export const OSK_OPEN_PX = 320;

const DEFAULT_LAYOUT = {
  default: [
    '1 2 3 4 5 6 7 8 9 0',
    'q w e r t y u i o p',
    'a s d f g h j k l',
    '{shift} z x c v b n m {bksp}',
    '{space}',
  ],
  shift: [
    '1 2 3 4 5 6 7 8 9 0',
    'Q W E R T Y U I O P',
    'A S D F G H J K L',
    '{shift} Z X C V B N M {bksp}',
    '{space}',
  ],
};

const NUMERIC_LAYOUT = {
  default: ['1 2 3', '4 5 6', '7 8 9', '{bksp} 0'],
};

const IP_LAYOUT = {
  default: ['1 2 3', '4 5 6', '7 8 9', '. 0 {bksp}'],
};

const DISPLAY = {
  '{bksp}': '⌫',
  '{space}': 'space',
  '{shift}': '⇧',
};

/**
 * Mounted once inside `.us-panel` (S-01-design.md §3). Publishes `--osk-h` on
 * the nearest `.us-panel` ancestor imperatively — the entire integration
 * surface with every screen — so no screen re-renders when this opens or
 * closes (frontend-conventions §1/§3).
 */
export function KeyboardHost(): JSX.Element {
  const open = useKeyboardStore((s) => s.open);
  const layout = useKeyboardStore((s) => s.layout);
  const press = useKeyboardStore((s) => s.press);
  const backspace = useKeyboardStore((s) => s.backspace);
  const close = useKeyboardStore((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(false);

  useEffect(() => {
    const panel = ref.current?.closest('.us-panel');
    if (!(panel instanceof HTMLElement)) return undefined;
    panel.style.setProperty('--osk-h', open ? `${OSK_OPEN_PX}px` : '0px');
    return () => {
      panel.style.setProperty('--osk-h', '0px');
    };
  }, [open]);

  useEffect(() => {
    if (!open) setShift(false);
  }, [open]);

  function handleKeyPress(button: string): void {
    if (button === '{bksp}') {
      backspace();
      return;
    }
    if (button === '{space}') {
      press(' ');
      return;
    }
    if (button === '{shift}') {
      setShift((s) => !s);
      return;
    }
    press(button);
    setShift(false);
  }

  return (
    // This outer node is the ref anchor and must always be mounted (it needs
    // to exist before `open` ever becomes true), but it must NEVER carry the
    // `.us-osk` visual treatment itself — that class is 380px tall with an
    // opaque background, so applying it unconditionally left a solid dark
    // block sitting over the bottom of the screen even while closed, with
    // nothing inside it. Only the panel below, rendered exclusively while
    // `open`, gets that styling.
    <div ref={ref} data-testid="keyboard-host">
      {open && (
        <div
          className="us-osk"
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.preventDefault()}
        >
          <div className="us-osk__row">
            <button
              type="button"
              className="us-osk__close"
              aria-label="Close keyboard"
              onClick={close}
            >
              ✕
            </button>
          </div>
          <div className="us-osk__keyboard">
            <Keyboard
              layoutName={layout === 'default' && shift ? 'shift' : 'default'}
              layout={
                layout === 'numeric' ? NUMERIC_LAYOUT : layout === 'ip' ? IP_LAYOUT : DEFAULT_LAYOUT
              }
              display={DISPLAY}
              onKeyPress={handleKeyPress}
              preventMouseDownDefault
              theme="hg-theme-default us-osk__keys"
            />
          </div>
        </div>
      )}
    </div>
  );
}
