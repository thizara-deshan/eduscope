import type { UserRole } from '@eduscope/shared';

export interface AdvancedNavItem {
  readonly path: string;
  readonly screen: string;
  readonly label: string;
  readonly icon: string;
  readonly roles: readonly UserRole[];
}

/**
 * One route/label/icon/role catalog for all 10 Advanced categories
 * (screen-inventory S-25). Order preserves the prototype's
 * `admin/AdminPage.tsx` `CATEGORIES` list, then appends the two categories
 * Wave 3 adds (Upload Queue, Device & Identity).
 */
export const ADVANCED_NAV_ITEMS: readonly AdvancedNavItem[] = [
  { path: '/advanced/network', screen: 'S-28', label: 'Network Settings', icon: '📶', roles: ['admin'] },
  { path: '/advanced/encoder', screen: 'S-29', label: 'Encoder Settings', icon: '🎛️', roles: ['admin'] },
  { path: '/advanced/storage', screen: 'S-30', label: 'Local Storage', icon: '💾', roles: ['admin'] },
  { path: '/advanced/firmware', screen: 'S-31', label: 'Firmware Update', icon: '🔄', roles: ['admin'] },
  { path: '/advanced/users', screen: 'S-32', label: 'User Management', icon: '👥', roles: ['admin'] },
  { path: '/advanced/logs', screen: 'S-34', label: 'System Logs', icon: '📄', roles: ['admin'] },
  { path: '/advanced/local-capture', screen: 'S-26', label: 'Local Capture Layout', icon: '🎬', roles: ['admin', 'lecturer'] },
  { path: '/advanced/streaming', screen: 'S-27', label: 'Streaming Configuration', icon: '📡', roles: ['admin', 'lecturer'] },
  { path: '/advanced/uploads', screen: 'S-35', label: 'Upload Queue', icon: '⬆️', roles: ['admin'] },
  { path: '/advanced/device', screen: 'S-36', label: 'Device & Identity', icon: '🆔', roles: ['admin'] },
];

export function navItemsForRole(role: UserRole): readonly AdvancedNavItem[] {
  return ADVANCED_NAV_ITEMS.filter((item) => item.roles.includes(role));
}
