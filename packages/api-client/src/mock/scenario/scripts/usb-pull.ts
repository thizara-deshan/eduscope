import type { ScenarioScript } from '../types.js';

/** S-23 failure path: the copy starts, then the drive is pulled mid-transfer.
 *  The source recordings are never touched (INV-EX-3) — Try again re-copies. */
export const usbPull: ScenarioScript = {
  name: 'usb-pull',
  description: 'A USB copy is interrupted: the drive is removed mid-transfer, the export fails, and the recordings stay safe on the device.',
  forced: [],
  seed: { exportOutcome: 'drive-removed' },
};
