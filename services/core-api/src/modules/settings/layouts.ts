import { eq } from 'drizzle-orm';
import type { ChannelId, LayoutPresetId } from '@eduscope/shared';
import { ProblemError } from '../../contracts/problem.js';
import type { DrizzleDb } from '../../db/client.js';
import { layoutPresets, physicalInputs, sourceBindings } from '../../db/schema.js';

export interface LayoutRatios {
  ratioA: number | null;
  ratioB: number | null;
}

/**
 * INV-LP-1/INV-SB-3 for a *candidate* preset+ratio combination on `channelId`
 * — used by `updateChannelConfig` to validate a PUT body before it is
 * persisted. `machine.ts#resolveToggleableChannel`/`guards.ts#resolveChannelValid`
 * validate the already-persisted row at command time; this task's settings
 * routes are the only write path for the row itself, so the two stay
 * independent rather than sharing a table-reading helper (INV-CC-2).
 */
export function resolveLayout(
  db: DrizzleDb,
  channelId: ChannelId,
  presetId: string,
  ratios: LayoutRatios,
): typeof layoutPresets.$inferSelect {
  const preset = db.select().from(layoutPresets).where(eq(layoutPresets.id, presetId as LayoutPresetId)).get();
  if (!preset) {
    throw new ProblemError(422, 'config.invalid', 'Unknown layout preset', { meta: { presetId } });
  }
  if (!preset.allowedChannels.includes(channelId)) {
    throw new ProblemError(422, 'config.invalid', `Preset "${presetId}" is not allowed on the ${channelId} channel`, {
      meta: { presetId },
    });
  }
  if (preset.parametric) {
    if (ratios.ratioA === null || ratios.ratioB === null || ratios.ratioA <= 0 || ratios.ratioB <= 0) {
      throw new ProblemError(422, 'config.invalid', 'Parametric presets require positive ratioA and ratioB', {
        meta: { presetId },
      });
    }
  }

  const bindings = db.select().from(sourceBindings).all();
  const inputs = db.select().from(physicalInputs).all();
  const bindingByRole = new Map(bindings.map((binding) => [binding.roleId, binding]));
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  for (const roleId of preset.requiredRoles) {
    const binding = bindingByRole.get(roleId);
    const bound = binding?.enabled === true && binding.physicalInputId !== null && inputById.has(binding.physicalInputId);
    if (!bound) {
      throw new ProblemError(422, 'config.invalid', 'A required source role is unbound', { meta: { roleId } });
    }
  }

  return preset;
}
