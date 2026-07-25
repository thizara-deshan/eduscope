// Mock data backing the System Administration (Advanced) section.
// Everything here is static prototype content — nothing is persisted.

export interface AdminUser {
  name: string
  username: string
  role: 'User' | 'Admin'
}

export const ADMIN_USERS: AdminUser[] = [
  { name: 'Dr. Sarath perera', username: 'user', role: 'User' },
  { name: 'System Administrator', username: 'admin', role: 'Admin' },
  { name: 'Prof. Luka Modric', username: 'lmodric', role: 'User' },
]

export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
  timestamp: string
  level: LogLevel
  category: 'Auth' | 'System' | 'Hardware' | 'Session'
  message: string
}

export const SYSTEM_LOGS: LogEntry[] = [
  { timestamp: '2026-06-24 10:15:32', level: 'INFO', category: 'Auth', message: 'User logged in successfully' },
  { timestamp: '2026-06-24 10:18:05', level: 'WARN', category: 'System', message: 'Firmware update check failed' },
  { timestamp: '2026-06-24 10:20:11', level: 'INFO', category: 'Hardware', message: 'CAM 1 connected successfully' },
  { timestamp: '2026-06-24 10:22:45', level: 'ERROR', category: 'Hardware', message: 'PC HDMI signal lost' },
  { timestamp: '2026-06-24 10:25:00', level: 'INFO', category: 'Session', message: 'Session started (Lecture: CO4420)' },
  { timestamp: '2026-06-24 10:30:12', level: 'INFO', category: 'Session', message: 'AI Question generation initiated' },
  { timestamp: '2026-06-24 10:32:15', level: 'WARN', category: 'Auth', message: 'Failed login attempt (Invalid credentials)' },
  { timestamp: '2026-06-24 10:35:48', level: 'INFO', category: 'Hardware', message: 'Mic 1 muted' },
  { timestamp: '2026-06-24 10:45:00', level: 'INFO', category: 'Session', message: 'Session ended normally' },
  { timestamp: '2026-06-24 10:50:33', level: 'INFO', category: 'System', message: 'System rebooted successfully' },
  { timestamp: '2026-06-24 10:52:10', level: 'ERROR', category: 'System', message: 'Local Storage mount point read-only failure' },
  { timestamp: '2026-06-24 10:55:04', level: 'INFO', category: 'Hardware', message: 'CAM 2 connected successfully' },
]

export const NETWORK_DEFAULTS = {
  lan: { ip: '192.168.1.100', subnet: '255.255.255.0', gateway: '192.168.1.1', dns: '8.8.8.8' },
  vlan: { ip: '10.0.1.100', subnet: '255.255.255.0', gateway: '10.0.1.1', dns: '1.1.1.1' },
  cameras: { cam1: '192.168.1.121', cam2: '192.168.1.122' },
}

export const STORAGE_INFO = {
  totalCapacity: '2.0 TB',
  freeSpace: '1.2 TB',
  diskHealth: 'Good',
}

export const FIRMWARE_VERSION = 'v2.4.0'

export const STREAMING_PLATFORMS = ['YouTube Live', 'Facebook Live', 'Twitch', 'Custom RTMP'] as const
