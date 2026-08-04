import type { PanelOperationId } from '@eduscope/shared';
import type { ScenarioEngine } from '../scenario/engine.js';
import type { MockWorld } from '../world.js';
import type { Seed } from '../seed/index.js';
import type { CredentialStore } from '../seed/users.js';
import { createAuthOperations } from './auth.js';
import { createRecordingOperations } from './recording.js';
import { createChannelsOperations } from './channels.js';
import { createSourcesOperations } from './sources.js';
import { createRecordingsOperations } from './recordings.js';
import { createUploadsOperations } from './uploads.js';
import { createProvisioningOperations } from './provisioning.js';
import { createDeviceOperations } from './device.js';
import { createStorageOperations } from './storage.js';
import { createSettingsOperations } from './settings.js';
import { createFirmwareOperations } from './firmware.js';
import { createUsersOperations } from './users.js';
import { createAiOperations } from './ai.js';
import { createQuizOperations } from './quiz.js';
import { createLogsOperations } from './logs.js';

export interface RestContext {
  readonly world: MockWorld;
  readonly engine: ScenarioEngine;
  readonly seed: Seed;
  /**
   * Deliberately a sibling of `seed`, not a member of it: `Seed` is the
   * contract-valid entity graph, and no entity in it may carry a password
   * (INV-U-1). The reference is readonly; the map itself is mutable, because
   * `changePassword`/`updateUser` write to it.
   */
  readonly credentials: CredentialStore;
}

/** One factory per contracts/openapi.yaml tag; all 77 PanelOperationIds land in the merged object below. */
export function createRestOperations(ctx: RestContext) {
  return {
    ...createAuthOperations(ctx),
    ...createRecordingOperations(ctx),
    ...createChannelsOperations(ctx),
    ...createSourcesOperations(ctx),
    ...createRecordingsOperations(ctx),
    ...createUploadsOperations(ctx),
    ...createProvisioningOperations(ctx),
    ...createDeviceOperations(ctx),
    ...createStorageOperations(ctx),
    ...createSettingsOperations(ctx),
    ...createFirmwareOperations(ctx),
    ...createUsersOperations(ctx),
    ...createAiOperations(ctx),
    ...createQuizOperations(ctx),
    ...createLogsOperations(ctx),
  } as Record<PanelOperationId, (...args: never[]) => Promise<unknown>>;
}
