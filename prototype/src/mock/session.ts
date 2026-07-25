import type { ChannelId, LayoutPreset, LayoutPresetId, MicState, OutputChannel } from '../types'

// Mock identity, sources, channels and mics used to seed the prototype.

export const MOCK_USER = {
  name: 'Dr. Sarath Perera',
  role: 'Senior Lecturer',
  initials: 'SP',
}

/** Labels for the physical sources referenced by layout presets. */
export const SOURCES = {
  cam1: 'CAM 1',
  cam2: 'CAM 2',
  pc: 'PC',
} as const

/** The live inputs shown in the LIVE VIDEO SOURCES panel. */
export interface VideoSource {
  id: 'hdmi' | 'cam1' | 'cam2'
  label: string
  /** Which mock feed to render: slide deck or presenter camera. */
  kind: 'pc' | 'cam'
}

export const VIDEO_SOURCES: VideoSource[] = [
  { id: 'hdmi', label: 'HDMI · Presentation', kind: 'pc' },
  { id: 'cam1', label: 'CAM 1 · Lecturer', kind: 'cam' },
  { id: 'cam2', label: 'CAM 2 · Students', kind: 'cam' },
]

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'fifty-fifty', name: '50 / 50', description: 'Half PC, half CAM 1' },
  { id: 'cams-fifty-fifty', name: '50 / 50', description: 'Half CAM 1, half CAM 2' },
  { id: 'side-by-side', name: 'Side by side', description: 'CAM 1 large, CAM 2 small' },
  { id: 'cam-1', name: 'Single — CAM 1', description: 'Only CAM 1' },
  { id: 'cam-2', name: 'Single — CAM 2', description: 'Only CAM 2' },
  { id: 'pc-only', name: 'PC only', description: 'Presentation feed on its own' },
  {
    id: 'separate-files',
    name: 'Separate files',
    description: 'PC and CAM 1 recorded as two files',
  },
]

/**
 * Which layouts each output offers. They deliberately differ: Live Meeting is
 * camera-only (online students already see the slides shared from the PC),
 * streaming can go presentation-only, and local capture can split the sources
 * into two files for post-production.
 */
export const CHANNEL_LAYOUTS: Record<ChannelId, LayoutPresetId[]> = {
  local: ['fifty-fifty', 'side-by-side', 'cam-1', 'cam-2', 'separate-files'],
  meeting: ['cams-fifty-fifty', 'cam-1', 'cam-2'],
  streaming: ['fifty-fifty', 'side-by-side', 'cam-1', 'cam-2', 'pc-only'],
}

/** The preset objects a channel offers, in `CHANNEL_LAYOUTS` order. */
export function layoutsFor(channelId: ChannelId): LayoutPreset[] {
  return CHANNEL_LAYOUTS[channelId].map((id) => LAYOUT_PRESETS.find((p) => p.id === id)!)
}

/** Human label for a preset id (ids are never shown in the UI). */
export function presetName(id: LayoutPresetId): string {
  return LAYOUT_PRESETS.find((p) => p.id === id)?.name ?? id
}

export const INITIAL_CHANNELS: OutputChannel[] = [
  {
    id: 'local',
    name: 'Local Capture',
    description: 'Always saved to the rack device',
    alwaysOn: true,
    enabled: true,
    preset: 'fifty-fifty',
  },
  {
    id: 'meeting',
    name: 'Live Meeting',
    description: 'Share with online students (Teams / Zoom)',
    alwaysOn: false,
    enabled: false,
    preset: 'cams-fifty-fifty',
    destination: 'Microsoft Teams',
  },
  {
    id: 'streaming',
    name: 'Live Streaming',
    description: 'Broadcast to YouTube / Facebook Live',
    alwaysOn: false,
    enabled: false,
    preset: 'fifty-fifty',
    destination: 'YouTube Live',
  },
]

export const INITIAL_MICS: MicState[] = [
  { id: 'lecture', name: 'Lecturer Mic', muted: false, gain: 70, device: 'Lavalier (wireless)' },
]
