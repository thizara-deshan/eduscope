import layoutPresetsJson from './layout-presets.json' with { type: 'json' };
import { zLayoutPreset, type LayoutPreset } from '../schemas/rest.js';

/**
 * The one shared v1 layout-preset catalog (A-03 gate correction). The mock's
 * seed and the generated Python resource
 * (`services/pipeline-manager/src/pipeline_manager/resources/layout-presets.v1.json`,
 * kept in sync by `services/pipeline-manager/scripts/sync_layout_catalog.py`)
 * both consume this file — geometry is never redeclared anywhere else.
 */
export const LAYOUT_PRESETS: readonly LayoutPreset[] = layoutPresetsJson.map((row) =>
  zLayoutPreset.parse(row),
);
