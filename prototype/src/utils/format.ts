/** Format a number of seconds as HH:MM:SS (or MM:SS when under an hour). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${mm}:${ss}`
  return `${mm}:${ss}`
}

/** Format a countdown (always MM:SS). */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Format a timestamp as a short clock time, e.g. "14:32". */
export function formatClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Format elapsed seconds as fixed HH : MM : SS digits for the big timer. */
export function formatTimerHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/** Time-of-day greeting for the idle hero, e.g. "Good morning,". */
export function greetingFor(now: Date): string {
  const h = now.getHours()
  if (h < 12) return 'Good morning,'
  if (h < 17) return 'Good afternoon,'
  return 'Good evening,'
}

/** Format a response time in ms as a compact seconds value, e.g. "8.2s". */
export function formatResponseTime(ms: number): string {
  if (!ms) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

/** Wall-clock parts for the header: weekday + date and HH:MM:SS. */
export function clockParts(now: Date): { date: string; time: string } {
  const date = now.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
  const time = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return { date, time }
}
