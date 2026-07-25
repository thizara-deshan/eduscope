// Core domain types for the Unistream frontend prototype.
// Everything here is mock-only — no backend contracts implied.

/**
 * Every recording layout the rack can produce. Channels don't all offer the
 * full set — see `CHANNEL_LAYOUTS` in `mock/session.ts` for what each one
 * exposes (e.g. Live Meeting only gets the three camera layouts).
 */
export type LayoutPresetId =
  | 'fifty-fifty'
  | 'cams-fifty-fifty'
  | 'side-by-side'
  | 'cam-1'
  | 'cam-2'
  | 'pc-only'
  | 'separate-files'

export interface LayoutPreset {
  id: LayoutPresetId
  name: string
  description: string
}

/** The three ways a session can be sent out. Local capture is always on. */
export type ChannelId = 'local' | 'meeting' | 'streaming'

export interface OutputChannel {
  id: ChannelId
  name: string
  /** Short helper text shown under the channel name. */
  description: string
  /** Local capture is always enabled and cannot be toggled off. */
  alwaysOn: boolean
  enabled: boolean
  preset: LayoutPresetId
  /** Mock destination (e.g. "YouTube Live", "Microsoft Teams"). */
  destination?: string
}

/** A single generated multiple-choice question. */
export interface MCQQuestion {
  id: string
  prompt: string
  options: string[]
  /** Index into `options` of the correct answer. */
  correctIndex: number
  /** True when hand-written by the lecturer (survives auto-generation). */
  custom?: boolean
}

/** A question that has been sent to the projector, with tracking metadata. */
export interface SentQuestion extends MCQQuestion {
  sentAt: number
  /** Only one sent question is "now showing" at a time. */
  showing: boolean
}

/** A student in the (mock) class roster. */
export interface Student {
  id: string
  name: string
  initials: string
}

/** One student's answer to a specific sent question. */
export interface StudentResponse {
  studentId: string
  /** Index into the question's `options` the student chose. */
  optionIndex: number
  correct: boolean
  /** How long they took to answer, in milliseconds. */
  responseTimeMs: number
}

/** An aggregated ranking row derived from all responses so far. */
export interface LeaderboardEntry {
  student: Student
  /** One point per correct answer. */
  points: number
  answered: number
  correct: number
  /** 0–100. */
  accuracy: number
  /** Average response time across answered questions, in milliseconds. */
  avgTimeMs: number
}

export type RecordingStatus = 'idle' | 'recording' | 'paused'

export interface MicState {
  id: 'lecture'
  name: string
  muted: boolean
  /** 0–100 mock gain level. */
  gain: number
  device: string
}

/** Allowed automatic-generation intervals, in minutes. */
export type IntervalMinutes = 10 | 15 | 20 | 30

export type Theme = 'light' | 'dark'

/** Simulated sign-in role; only admins can open System Administration. */
export type Role = 'admin' | 'lecturer'

export interface SessionUser {
  name: string
  role: Role
}
