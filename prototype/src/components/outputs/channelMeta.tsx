import { HardDrive, Radio, Users } from 'lucide-react'
import type { ChannelId } from '../../types'
import type { ReactNode } from 'react'

/** Shared icon + accent per output channel, used by the strip and drawer. */
export const CHANNEL_ICONS: Record<ChannelId, (size?: number) => ReactNode> = {
  local: (size = 20) => <HardDrive size={size} />,
  meeting: (size = 20) => <Users size={size} />,
  streaming: (size = 20) => <Radio size={size} />,
}
