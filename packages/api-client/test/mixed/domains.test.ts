import { describe, expect, it } from 'vitest';
import {
  PANEL_EVENT_NAMES,
  PANEL_OPERATION_IDS,
  SERVER_SIDE_ONLY_OPERATION_IDS,
} from '@eduscope/shared';
import {
  ADAPTER_DOMAINS,
  PANEL_EVENT_DOMAIN,
  PANEL_OPERATION_DOMAIN,
} from '../../src/mixed/domains.js';

describe('adapter domain catalog', () => {
  it('lists exactly the nineteen runtime domains', () => {
    expect([...ADAPTER_DOMAINS]).toEqual([
      'auth', 'recording', 'channels', 'sourcesAudio', 'preview',
      'libraryExport', 'uploads', 'provisioningHealth', 'alerts',
      'devicePower', 'storage', 'network', 'encoder', 'streamTargets',
      'firmware', 'users', 'aiQuiz', 'logs', 'studentQuiz',
    ]);
  });

  it('assigns every one of the 79 panel operations a domain exactly once', () => {
    const keys = Object.keys(PANEL_OPERATION_DOMAIN);
    expect(keys).toHaveLength(79);
    expect(PANEL_OPERATION_IDS).toHaveLength(79);
    for (const id of PANEL_OPERATION_IDS) {
      expect(PANEL_OPERATION_DOMAIN[id], `no domain for operation ${id}`).toBeTruthy();
    }
    // No key beyond the contract's operation set.
    const contract = new Set<string>(PANEL_OPERATION_IDS);
    expect(keys.filter((k) => !contract.has(k))).toEqual([]);
    // Every assigned domain is a real domain.
    const domains = new Set<string>(ADAPTER_DOMAINS);
    for (const id of PANEL_OPERATION_IDS) {
      expect(domains.has(PANEL_OPERATION_DOMAIN[id])).toBe(true);
    }
  });

  it('assigns every one of the 22 panel events a domain exactly once', () => {
    const keys = Object.keys(PANEL_EVENT_DOMAIN);
    expect(keys).toHaveLength(22);
    expect(PANEL_EVENT_NAMES).toHaveLength(22);
    for (const name of PANEL_EVENT_NAMES) {
      expect(PANEL_EVENT_DOMAIN[name], `no domain for event ${name}`).toBeTruthy();
    }
    const catalogued = new Set<string>(PANEL_EVENT_NAMES);
    expect(keys.filter((k) => !catalogued.has(k))).toEqual([]);
  });

  it('never assigns a panel operation to the studentQuiz domain', () => {
    const owned = Object.values(PANEL_OPERATION_DOMAIN);
    expect(owned).not.toContain('studentQuiz');
  });

  it('never carries a server-side quiz-sync operation', () => {
    for (const id of SERVER_SIDE_ONLY_OPERATION_IDS) {
      expect(id in PANEL_OPERATION_DOMAIN).toBe(false);
    }
  });
});
