/**
 * `provisioning` matches the shell detector's key (`shell/use-provisioning.ts`)
 * on purpose — both read `getProvisioning`, and sharing the string lets them
 * share one cache entry.
 */
export const DEVICE_KEYS = {
  provisioning: ['provisioning'] as const,
  health: ['device-health'] as const,
  alerts: (includeCleared: boolean) => ['alerts', { includeCleared }] as const,
};
