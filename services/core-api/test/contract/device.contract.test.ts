import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zAcknowledgeAlertResponse, zGetDeviceHealthResponse, zGetProvisioningResponse, zListAlertsResponse } from '@eduscope/shared';
import { registerDeviceRoutes } from '../../src/modules/device/routes.js';
import { AlertStore } from '../../src/modules/device/alerts.js';
import { HealthAggregator } from '../../src/modules/device/health.js';
import { ProvisioningReader } from '../../src/modules/device/provisioning.js';

describe('device v1 contracts', () => {
  it('owns getProvisioning/getDeviceHealth/listAlerts/acknowledgeAlert and their shared response shapes', () => {
    expect(registerDeviceRoutes).toBeTypeOf('function');
    expect(AlertStore).toBeTypeOf('function');
    expect(HealthAggregator).toBeTypeOf('function');
    expect(ProvisioningReader).toBeTypeOf('function');

    expect(
      zGetProvisioningResponse.safeParse({
        deviceId: '01KQHFP680S9YDXZAX7CJ32CKF',
        serialNumber: null,
        instituteProfileId: 'institute-1',
        hallCode: 'LAC001',
        hallDisplayName: 'Lecture Hall 1',
        titlePattern: '{hall} – {date} {time}',
        timezone: 'Asia/Colombo',
        ntpServers: ['ntp.example.org'],
        expectedStorageVolumeUuid: null,
        featureFlags: { recordingEnabled: true, aiQuizEnabled: true, streamingEnabled: false },
        quizServerBaseUrl: null,
        llmEndpoint: null,
        provisionedAt: '2026-08-19T00:00:00.000Z',
        provisionedBy: 'deploy',
      }).success,
    ).toBe(true);

    expect(
      zGetDeviceHealthResponse.safeParse({
        deviceId: '01KQHFP680S9YDXZAX7CJ32CKF',
        observedAt: '2026-08-19T00:00:00.000Z',
        storageTotalBytes: 1000,
        storageFreeBytes: 500,
        storagePressure: 'ok',
        diskHealth: 'good',
        captureCardState: 'present',
        publisherStates: { 'lecturer-cam': { status: 'running', lastErrorCode: null, since: '2026-08-19T00:00:00.000Z' } },
        ntpSynced: true,
        clockOffsetMs: 5,
        lastBootAt: '2026-08-19T00:00:00.000Z',
        cpuLoad1m: null,
        tempC: null,
      }).success,
    ).toBe(true);

    expect(
      zListAlertsResponse.safeParse({
        items: [
          {
            id: '01KQHFP680S9YDXZAX7CJ32CKF',
            code: 'storage.critical',
            severity: 'critical',
            category: 'System',
            title: 'Storage critical',
            detail: null,
            raisedAt: '2026-08-19T00:00:00.000Z',
            clearedAt: null,
            clearedReason: null,
            acknowledgedBy: null,
            context: null,
            relatedEntity: null,
          },
        ],
      }).success,
    ).toBe(true);

    expect(
      zAcknowledgeAlertResponse.safeParse({
        id: '01KQHFP680S9YDXZAX7CJ32CKF',
        code: 'storage.critical',
        severity: 'critical',
        category: 'System',
        title: 'Storage critical',
        detail: null,
        raisedAt: '2026-08-19T00:00:00.000Z',
        clearedAt: null,
        clearedReason: null,
        acknowledgedBy: '01KQHFP680S9YDXZAX7CJ32CKG',
        context: null,
        relatedEntity: null,
      }).success,
    ).toBe(true);

    const openapi = readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi.yaml'), 'utf8');
    expect(openapi).toContain('operationId: getProvisioning');
    expect(openapi).toContain('operationId: getDeviceHealth');
    expect(openapi).toContain('operationId: listAlerts');
    expect(openapi).toContain('operationId: acknowledgeAlert');
  });
});
