import { describe, expect, it } from 'vitest';
import { getScenario } from '../../src/mock/scenario/registry.js';
import { createDeviceSeed } from '../../src/mock/seed/device.js';

describe('Wave 6 — capture-fault scenario + admin world knobs', () => {
  it('capture-fault intercepts HL-22 (recover) to HL-23 (failed)', () => {
    const s = getScenario('capture-fault');
    expect(s.forced[0]?.replace).toBe('HL-23');
  });

  it('provisioned:false leaves expectedStorageVolumeUuid null (hallCode is contract-required, stays set)', () => {
    const seed = createDeviceSeed({ provisioned: false });
    expect(seed.provisioning.expectedStorageVolumeUuid).toBeNull();
    expect(seed.provisioning.hallCode).toBeTruthy();
  });

  it('clockSynced:false unsyncs the clock and raises a clock.unsynced alert', () => {
    const seed = createDeviceSeed({ clockSynced: false });
    expect(seed.deviceHealth.ntpSynced).toBe(false);
    expect(seed.deviceHealth.clockOffsetMs).toBe(4200);
    expect(seed.alerts.some((a) => a.code === 'clock.unsynced')).toBe(true);
  });

  it('seeds three publisher rows including an exited mic-lecturer with lastErrorCode', () => {
    const seed = createDeviceSeed({});
    expect(seed.deviceHealth.publisherStates['mic-lecturer']).toMatchObject({
      status: 'exited', lastErrorCode: 'alsa_xrun',
    });
  });

  it('diskHealth knob drives both device health and the recordings volume SMART status', () => {
    const seed = createDeviceSeed({ diskHealth: 'failing' });
    expect(seed.deviceHealth.diskHealth).toBe('failing');
    expect(seed.storage.volumes[0]?.smartStatus).toBe('failing');
  });
});
