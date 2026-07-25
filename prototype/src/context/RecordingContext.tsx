import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ChannelId, LayoutPresetId, MicState, OutputChannel, RecordingStatus } from '../types'
import { INITIAL_CHANNELS, INITIAL_MICS } from '../mock/session'

interface RecordingContextValue {
  status: RecordingStatus
  elapsedSec: number
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void

  channels: OutputChannel[]
  toggleChannel: (id: ChannelId) => void
  setChannelPreset: (id: ChannelId, preset: LayoutPresetId) => void
  setChannelDestination: (id: ChannelId, destination: string) => void

  mics: MicState[]
  toggleMute: (id: MicState['id']) => void
  /** Master mute for the Room Controls "Microphones" switch. */
  setAllMuted: (muted: boolean) => void
  setGain: (id: MicState['id'], gain: number) => void
  setDevice: (id: MicState['id'], device: string) => void
}

const RecordingContext = createContext<RecordingContextValue | null>(null)

export function RecordingProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [channels, setChannels] = useState<OutputChannel[]>(INITIAL_CHANNELS)
  const [mics, setMics] = useState<MicState[]>(INITIAL_MICS)

  // Tick the elapsed timer once per second while actively recording.
  const intervalRef = useRef<number | null>(null)
  useEffect(() => {
    if (status === 'recording') {
      intervalRef.current = window.setInterval(() => setElapsedSec((s) => s + 1), 1000)
    }
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
    }
  }, [status])

  const start = useCallback(() => {
    setElapsedSec(0)
    setStatus('recording')
  }, [])
  const pause = useCallback(() => setStatus('paused'), [])
  const resume = useCallback(() => setStatus('recording'), [])
  const stop = useCallback(() => {
    setStatus('idle')
    setElapsedSec(0)
  }, [])

  const toggleChannel = useCallback((id: ChannelId) => {
    setChannels((cs) =>
      cs.map((c) => (c.id === id && !c.alwaysOn ? { ...c, enabled: !c.enabled } : c)),
    )
  }, [])
  const setChannelPreset = useCallback((id: ChannelId, preset: LayoutPresetId) => {
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, preset } : c)))
  }, [])
  const setChannelDestination = useCallback((id: ChannelId, destination: string) => {
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, destination } : c)))
  }, [])

  const toggleMute = useCallback((id: MicState['id']) => {
    setMics((ms) => ms.map((m) => (m.id === id ? { ...m, muted: !m.muted } : m)))
  }, [])
  const setAllMuted = useCallback((muted: boolean) => {
    setMics((ms) => ms.map((m) => ({ ...m, muted })))
  }, [])
  const setGain = useCallback((id: MicState['id'], gain: number) => {
    setMics((ms) => ms.map((m) => (m.id === id ? { ...m, gain } : m)))
  }, [])
  const setDevice = useCallback((id: MicState['id'], device: string) => {
    setMics((ms) => ms.map((m) => (m.id === id ? { ...m, device } : m)))
  }, [])

  return (
    <RecordingContext.Provider
      value={{
        status,
        elapsedSec,
        start,
        pause,
        resume,
        stop,
        channels,
        toggleChannel,
        setChannelPreset,
        setChannelDestination,
        mics,
        toggleMute,
        setAllMuted,
        setGain,
        setDevice,
      }}
    >
      {children}
    </RecordingContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRecording() {
  const ctx = useContext(RecordingContext)
  if (!ctx) throw new Error('useRecording must be used within RecordingProvider')
  return ctx
}
