import { create } from 'zustand';

/**
 * Codes the shell must not render as banners right now (S12-D-3).
 *
 * U-5 puts a refusal next to the control that was pressed, so the panel that
 * ISSUED a refused command reads the 409 and must not also see the cross-panel
 * `system.alert` carrying the same fact — two carriers for one fact on one
 * screen is how a user learns to ignore banners. The banner-host row stays: it
 * is still the correct carrier for a SECOND panel.
 *
 * A dedicated store rather than a WS-store field (W2-D-6): the WS store holds
 * contract-typed slices and is cleared by `reset()` on every scenario switch,
 * which is the wrong lifetime. This one is owned by a mount/unmount effect on
 * the dialog that issued the command.
 */
interface AlertSuppressionState {
  readonly codes: readonly string[];
  suppress(code: string): void;
  release(code: string): void;
}

export const useAlertSuppression = create<AlertSuppressionState>((set) => ({
  codes: [],
  suppress: (code) => set((s) => (s.codes.includes(code) ? s : { codes: [...s.codes, code] })),
  release: (code) => set((s) => ({ codes: s.codes.filter((c) => c !== code) })),
}));
