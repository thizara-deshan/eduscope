import { readFileSync, statSync } from 'node:fs';
import type { DeviceProvisioning } from '@eduscope/shared';
import { z } from 'zod';
import { ProblemError } from '../../contracts/problem.js';

/**
 * `.passthrough()` so a provisioning file carrying deploy-only secret fields
 * (AD-10) parses without needing a shape for them here — `read()` below picks
 * only the named DeviceProvisioning fields onto the returned object, so those
 * extra fields are never echoed (INV-DP-1's secret-free read view).
 */
const zProvisioningFile = z
  .object({
    deviceId: z.string().min(1),
    serialNumber: z.string().max(64).nullable().default(null),
    instituteProfileId: z.string().min(1).max(64),
    hallCode: z.string().min(1).max(32),
    hallDisplayName: z.string().min(1).max(128),
    titlePattern: z.string().min(1).max(128),
    timezone: z.string().min(1).max(64),
    ntpServers: z.array(z.string()).default([]),
    expectedStorageVolumeUuid: z.string().max(64).nullable().default(null),
    featureFlags: z.object({
      recordingEnabled: z.boolean(),
      aiQuizEnabled: z.boolean(),
      streamingEnabled: z.boolean(),
    }),
    quizServerBaseUrl: z.string().nullable().default(null),
    llmEndpoint: z.string().nullable().default(null),
    provisionedAt: z.string().min(1),
    provisionedBy: z.string().max(128).nullable().default(null),
  })
  .passthrough();

/**
 * G-PROVISIONED (INV-DP-2). Reads `/etc/eduscope/provisioning.json` per use
 * (never writes it, INV-DP-1) with an mtime-invalidated cache so B-26's
 * boot-frozen flag cannot recur (INV-DP-3): a call after the file changes
 * always re-parses; a call between edits skips the redundant read+parse.
 */
export class ProvisioningReader {
  readonly #path: string;
  #cachedMtimeMs: number | null = null;
  #cached: DeviceProvisioning | null = null;

  constructor(path: string) {
    this.#path = path;
  }

  read(): DeviceProvisioning {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.#path).mtimeMs;
    } catch {
      throw new ProblemError(422, 'provisioning.incomplete', 'Device is not provisioned', {
        detail: 'missing or unreadable provisioning file',
      });
    }

    if (this.#cached !== null && this.#cachedMtimeMs === mtimeMs) {
      return this.#cached;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.#path, 'utf8'));
    } catch {
      throw new ProblemError(422, 'provisioning.incomplete', 'Device is not provisioned', {
        detail: 'missing or unreadable provisioning file',
      });
    }

    const parsed = zProvisioningFile.safeParse(raw);
    if (!parsed.success) {
      throw new ProblemError(422, 'provisioning.incomplete', 'Device is not provisioned', {
        detail: 'incomplete provisioning file',
      });
    }

    const value: DeviceProvisioning = {
      deviceId: parsed.data.deviceId,
      serialNumber: parsed.data.serialNumber,
      instituteProfileId: parsed.data.instituteProfileId,
      hallCode: parsed.data.hallCode,
      hallDisplayName: parsed.data.hallDisplayName,
      titlePattern: parsed.data.titlePattern,
      timezone: parsed.data.timezone,
      ntpServers: parsed.data.ntpServers,
      expectedStorageVolumeUuid: parsed.data.expectedStorageVolumeUuid,
      featureFlags: parsed.data.featureFlags,
      quizServerBaseUrl: parsed.data.quizServerBaseUrl,
      llmEndpoint: parsed.data.llmEndpoint,
      provisionedAt: parsed.data.provisionedAt,
      provisionedBy: parsed.data.provisionedBy,
    };

    this.#cached = value;
    this.#cachedMtimeMs = mtimeMs;
    return value;
  }
}
