import { useRecording } from '../context/RecordingContext'
import { greetingFor } from '../utils/format'

/**
 * The first thing a lecturer sees after logging in: their name and one
 * unmistakable Start Recording button. Nothing else competes for attention.
 */
export function IdleHero({ name }: { name: string }) {
  const { start } = useRecording()

  return (
    <div className="us-hero">
      <p className="us-hero__greeting">{greetingFor(new Date())}</p>
      <h1 className="us-hero__name">{name}</h1>
      <button className="us-hero__start" onClick={start}>
        <span className="us-hero__startdot" />
        Start Recording
      </button>
    </div>
  )
}
