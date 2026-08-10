import {
  zCommandAccepted, zStorageOverview, zStorageVolume,
  type CommandAccepted, type FormatVolumeRequest, type RegisterVolumeRequest,
  type StorageOverview, type StorageVolume, type Ulid,
} from '@eduscope/shared';
import { ProblemError } from '../../errors.js';
import { RESOLVE_BY_SEC } from '../commands.js';
import { validated, nowIsoZ } from '../seed/index.js';
import { nextUlid } from '../world.js';
import { requireAdmin } from './auth.js';
import type { RestContext } from './index.js';

export function createStorageOperations(ctx: RestContext) {
  const { world, engine, seed } = ctx;

  return {
    getStorageOverview: async (): Promise<StorageOverview> =>
      validated(zStorageOverview, {
        pressure: world.state('storage'),
        totalBytes: seed.storage.totalBytes,
        freeBytes: seed.storage.freeBytes,
        volumes: seed.storage.volumes,
        policy: seed.storage.policy,
      }),

    registerStorageVolume: async (body: RegisterVolumeRequest): Promise<StorageVolume> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('registerStorageVolume');
      if (refusal) throw new ProblemError(refusal);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.uuid)) {
        throw new ProblemError({ status: 422, code: 'validation.invalid', title: 'Not a valid volume uuid' });
      }
      if (seed.storage.volumes.some((v) => v.uuid === body.uuid)) {
        throw new ProblemError({ status: 409, code: 'conflict', title: `Volume ${body.uuid} is already registered` });
      }
      const volume = validated(zStorageVolume, {
        id: nextUlid(world),
        uuid: body.uuid,
        devicePath: `/dev/${body.uuid.slice(0, 8)}`,
        mountPath: `/media/${body.uuid.slice(0, 8)}`,
        label: body.label ?? null,
        filesystem: 'ext4',
        capacityBytes: seed.storage.volumes[0]?.capacityBytes ?? 500_000_000_000,
        freeBytes: seed.storage.volumes[0]?.capacityBytes ?? 500_000_000_000,
        smartStatus: 'good',
        role: 'recordings',
        state: 'mounted',
        registeredAt: nowIsoZ(world.clock),
      });
      seed.storage.volumes.push(volume);
      return volume;
    },

    formatStorageVolume: async (volumeId: Ulid, body: FormatVolumeRequest): Promise<CommandAccepted> => {
      requireAdmin(ctx);
      const refusal = engine.onCommand('formatStorageVolume');
      if (refusal) throw new ProblemError(refusal);
      const volume = seed.storage.volumes.find((v) => v.id === volumeId);
      if (!volume) throw new ProblemError({ status: 404, code: 'not-found', title: `Unknown volume: ${volumeId}` });
      if (world.state('recording') !== 'idle') {
        throw new ProblemError({
          status: 409,
          code: 'format.refused',
          title: 'A lecture is in progress — format is refused while recording',
        });
      }
      const expected = volume.label ?? volume.uuid;
      if (body.confirmText !== expected) {
        throw new ProblemError({
          status: 422,
          code: 'validation.invalid',
          title: `Type "${expected}" to confirm formatting this volume`,
        });
      }
      volume.state = 'formatting';
      return validated(zCommandAccepted, {
        commandId: nextUlid(world),
        acceptedAt: nowIsoZ(world.clock),
        resolveBySec: RESOLVE_BY_SEC,
      });
    },
  };
}
