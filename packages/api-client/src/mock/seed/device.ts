import {
  zDeviceHealth, zDeviceProvisioning, zEncodingProfile, zEncoderCapabilities,
  zFirmwareUpdate, zLogEntry, zNetworkConfig, zStorageVolume,
  zStreamTarget, zSystemAlert,
  type DeviceHealth, type DeviceProvisioning, type EncoderCapabilities,
  type EncodingProfile, type FirmwareUpdate, type LogEntry, type NetworkConfig,
  type RetentionPolicy, type StorageVolume, type StreamTarget, type SystemAlert,
} from '@eduscope/shared';
import type { WorldSeed } from '../scenario/types.js';
import { SEED_EPOCH, seedId, validated } from './index.js';

export interface DeviceSeed {
  readonly provisioning: DeviceProvisioning;
  readonly deviceHealth: DeviceHealth;
  readonly alerts: SystemAlert[];
  readonly storage: {
    readonly volumes: StorageVolume[];
    readonly policy: RetentionPolicy;
    readonly totalBytes: number;
    readonly freeBytes: number;
  };
  readonly networkConfigs: NetworkConfig[];
  readonly encoderSettings: { readonly profile: EncodingProfile; readonly capabilities: EncoderCapabilities };
  readonly streamTargets: StreamTarget[];
  readonly firmware: FirmwareUpdate;
  readonly logs: LogEntry[];
}

/** state-machines §6.3 defaults — the same values health.ts's storageMachine payload builder falls back to. */
const RETENTION_POLICY: RetentionPolicy = {
  maxAgeDays: 90,
  warningThresholdPct: 70,
  criticalThresholdPct: 90,
  earlyDeleteOrder: 'uploaded-oldest-first',
  neverDeleteUnuploaded: true,
  refuseStartWhenCritical: true,
};

export function createDeviceSeed(overrides: Partial<WorldSeed>): DeviceSeed {
  const aiEnabled = overrides.aiEnabled ?? true;
  const quizAvailable = overrides.quizAvailable ?? true;

  // hallCode/hallDisplayName/titlePattern are all non-empty so G-PROVISIONED
  // passes; llmEndpoint is non-null unless the seed override turns AI off
  // (G-AI-ENABLED).
  const provisioning = validated(zDeviceProvisioning, {
    deviceId: seedId('device'),
    serialNumber: 'ESC-0001-2026',
    instituteProfileId: 'uom-colombo',
    hallCode: 'ENG-A301',
    hallDisplayName: 'Engineering Auditorium A301',
    titlePattern: '{hallDisplayName} — {date}',
    timezone: 'Asia/Colombo',
    ntpServers: ['0.lk.pool.ntp.org', '1.lk.pool.ntp.org'],
    expectedStorageVolumeUuid: 'a1b2c3d4-0000-4000-8000-000000000001',
    featureFlags: {
      recordingEnabled: true,
      aiQuizEnabled: aiEnabled,
      streamingEnabled: true,
    },
    quizServerBaseUrl: quizAvailable ? 'https://quiz.eduscope.local' : null,
    llmEndpoint: aiEnabled ? 'https://ai.eduscope.local/v1' : null,
    provisionedAt: SEED_EPOCH,
    provisionedBy: 'deploy-bot',
  } satisfies DeviceProvisioning);

  const deviceHealth = validated(zDeviceHealth, {
    deviceId: provisioning.deviceId,
    observedAt: SEED_EPOCH,
    storageTotalBytes: 500_000_000_000,
    storageFreeBytes: 260_000_000_000,
    storagePressure: overrides.storagePressure ?? 'ok',
    diskHealth: 'good',
    captureCardState: 'present',
    publisherStates: {},
    ntpSynced: true,
    clockOffsetMs: 12,
    lastBootAt: SEED_EPOCH,
    cpuLoad1m: 0.42,
    tempC: 51.5,
  } satisfies DeviceHealth);

  const alerts = [
    {
      id: seedId('alert'),
      code: 'firmware.update-available',
      severity: 'info' as const,
      category: 'System' as const,
      title: 'A firmware update is available',
      detail: null,
      raisedAt: SEED_EPOCH,
      clearedAt: null,
      clearedReason: null,
      acknowledgedBy: null,
      context: null,
      relatedEntity: null,
    },
    {
      id: seedId('alert'),
      code: 'source.degraded',
      severity: 'warning' as const,
      category: 'Hardware' as const,
      title: 'students-cam was briefly degraded',
      detail: 'Recovered on its own after 4s.',
      raisedAt: SEED_EPOCH,
      clearedAt: SEED_EPOCH,
      clearedReason: 'resolved' as const,
      acknowledgedBy: null,
      context: null,
      relatedEntity: { type: 'SourceRole', id: 'students-cam' },
    },
  ].map((row) => validated(zSystemAlert, row));

  const volume: StorageVolume = validated(zStorageVolume, {
    id: seedId('volume'),
    uuid: 'a1b2c3d4-0000-4000-8000-000000000001',
    devicePath: '/dev/nvme0n1p1',
    mountPath: '/var/lib/eduscope/recordings',
    label: 'RECORDINGS',
    filesystem: 'ext4',
    capacityBytes: 500_000_000_000,
    freeBytes: 260_000_000_000,
    smartStatus: 'good',
    role: 'recordings',
    state: 'mounted',
    registeredAt: SEED_EPOCH,
  } satisfies StorageVolume);

  const networkConfigs = [
    {
      id: seedId('net'),
      interfaceName: 'eth0',
      kind: 'lan' as const,
      vlanId: null,
      addressMode: 'static' as const,
      ipv4Address: '10.20.4.12',
      prefixLength: 24,
      gateway: '10.20.4.1',
      dnsServers: ['10.20.0.53'],
      appliedAt: SEED_EPOCH,
      lastApplyError: null,
    },
    {
      id: seedId('net'),
      interfaceName: 'eth0.100',
      kind: 'vlan' as const,
      vlanId: 100,
      addressMode: 'dhcp' as const,
      ipv4Address: null,
      prefixLength: null,
      gateway: null,
      dnsServers: [],
      appliedAt: null,
      lastApplyError: null,
    },
  ].map((row) => validated(zNetworkConfig, row));

  const encoderProfile: EncodingProfile = validated(zEncodingProfile, {
    id: seedId('encoder-profile'),
    scope: 'device-default',
    channelId: null,
    videoBitrateKbps: 4000,
    framerate: 30,
    gop: 60,
    rateControl: 'cbr',
    codec: 'h264',
    container: 'mpegts',
    audioCodec: 'aac',
    audioBitrateKbps: 128,
    capabilityVerifiedAt: SEED_EPOCH,
  } satisfies EncodingProfile);

  const encoderCapabilities: EncoderCapabilities = validated(zEncoderCapabilities, {
    videoBitrateKbps: { min: 2000, max: 8000 },
    framerates: [24, 25, 30],
    gops: [30, 60, 90],
    rateControls: ['cbr', 'vbr'],
    codecs: ['h264'],
    audioBitratesKbps: [96, 128, 192],
  } satisfies EncoderCapabilities);

  const streamTargets = [
    {
      id: seedId('stream-target'),
      platform: 'youtube' as const,
      displayName: 'Main YouTube Channel',
      ingestUrl: 'rtmp://a.rtmp.youtube.com/live2',
      hasStreamKey: true,
      requiresTlsBridge: false,
      enabled: true,
      lastPreflightAt: SEED_EPOCH,
      lastPreflightResult: 'ok' as const,
    },
  ].map((row) => validated(zStreamTarget, row));

  const firmware = validated(zFirmwareUpdate, {
    id: seedId('firmware'),
    currentVersion: '2026.1.3',
    availableVersion: null,
    state: 'idle',
    signatureVerified: true,
    rollbackVersion: '2026.1.2',
    startedAt: null,
    finishedAt: null,
    lastError: null,
  } satisfies FirmwareUpdate);

  const logs = [
    { level: 'INFO' as const, category: 'System' as const, service: 'core-api' as const, message: 'Device booted.' },
    { level: 'INFO' as const, category: 'Auth' as const, service: 'core-api' as const, message: 'a.perera logged in.' },
    { level: 'WARN' as const, category: 'Hardware' as const, service: 'pipeline-manager' as const, message: 'students-cam reported degraded signal.' },
    { level: 'ERROR' as const, category: 'System' as const, service: 'ai' as const, message: 'LLM request timed out after 45s.' },
    { level: 'INFO' as const, category: 'Session' as const, service: 'core-api' as const, message: 'Recording session finalized.' },
    { level: 'INFO' as const, category: 'System' as const, service: 'deploy' as const, message: 'Firmware check completed; device is current.' },
  ].map((row) =>
    validated(zLogEntry, {
      id: seedId('log'),
      at: SEED_EPOCH,
      context: null,
      sessionId: null,
      userId: null,
      ...row,
    }),
  );

  return {
    provisioning,
    deviceHealth,
    alerts,
    storage: {
      volumes: [volume],
      policy: RETENTION_POLICY,
      totalBytes: volume.capacityBytes,
      freeBytes: volume.freeBytes,
    },
    networkConfigs,
    encoderSettings: { profile: encoderProfile, capabilities: encoderCapabilities },
    streamTargets,
    firmware,
    logs,
  };
}
