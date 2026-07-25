import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  IntervalMinutes,
  LeaderboardEntry,
  MCQQuestion,
  SentQuestion,
  StudentResponse,
} from '../types'
import { generateQuestionBatch } from '../mock/questions'
import { CLASS_ROSTER, CLASS_SIZE, simulateResponses } from '../mock/students'
import { useRecording } from './RecordingContext'

/**
 * Prototype-only demo acceleration for the auto-generation countdown.
 * The countdown *displays* honest mm:ss for the chosen interval, but advances
 * this many "session seconds" per real second so reviewers can watch an
 * automatic generation happen without waiting the full 20 minutes.
 * Set to 1 for true real-time behaviour.
 */
export const COUNTDOWN_SPEED = 20
const TICK_MS = 200

interface QuestionContextValue {
  intervalMinutes: IntervalMinutes
  setIntervalMinutes: (m: IntervalMinutes) => void
  /** Seconds remaining until the next automatic generation. */
  remainingSec: number
  /** True briefly while a batch is being "generated". */
  generating: boolean
  currentBatch: MCQQuestion[]
  generateNow: () => void
  /** Add a lecturer-written question to the Generated list. */
  addQuestion: (q: Omit<MCQQuestion, 'id' | 'custom'>) => void
  updateQuestion: (id: string, patch: Partial<MCQQuestion>) => void
  discardQuestion: (id: string) => void

  sent: SentQuestion[]
  sendToProjector: (q: MCQQuestion) => void
  setShowing: (id: string) => void
  removeSent: (id: string) => void

  /** Live student responses, keyed by sent-question id. */
  responsesByQuestion: Record<string, StudentResponse[]>
  /** Number of students in the mock class. */
  classSize: number
  /** Overall class ranking, derived from every response so far. */
  leaderboard: LeaderboardEntry[]
  /** Ids of questions whose responses are still streaming in. */
  respondingIds: string[]
}

const QuestionContext = createContext<QuestionContextValue | null>(null)

export function QuestionProvider({ children }: { children: ReactNode }) {
  const { status } = useRecording()
  const [intervalMinutes, setIntervalMinutesState] = useState<IntervalMinutes>(15)
  const [remainingSec, setRemainingSec] = useState(15 * 60)
  const [generating, setGenerating] = useState(false)
  const [currentBatch, setCurrentBatch] = useState<MCQQuestion[]>([])
  const [sent, setSent] = useState<SentQuestion[]>([])
  const [responsesByQuestion, setResponsesByQuestion] = useState<
    Record<string, StudentResponse[]>
  >({})
  const [respondingIds, setRespondingIds] = useState<string[]>([])

  const resetCountdown = useCallback((minutes: IntervalMinutes) => {
    setRemainingSec(minutes * 60)
  }, [])

  const doGenerate = useCallback(() => {
    setGenerating(true)
    // Small delay so the "thinking" state is visible in the prototype.
    // Lecturer-written questions survive each fresh AI batch.
    window.setTimeout(() => {
      setCurrentBatch((prev) => [...prev.filter((q) => q.custom), ...generateQuestionBatch()])
      setGenerating(false)
    }, 650)
  }, [])

  const generateNow = useCallback(() => {
    doGenerate()
    resetCountdown(intervalMinutes)
  }, [doGenerate, resetCountdown, intervalMinutes])

  const setIntervalMinutes = useCallback(
    (m: IntervalMinutes) => {
      setIntervalMinutesState(m)
      resetCountdown(m)
    },
    [resetCountdown],
  )

  // React to recording-status transitions during render (the endorsed pattern
  // for "adjust state when something changes"): reset the countdown when a
  // fresh recording starts, and when the session returns to idle.
  const [prevStatus, setPrevStatus] = useState(status)
  if (status !== prevStatus) {
    setPrevStatus(status)
    if (status === 'recording' && prevStatus === 'idle') {
      setRemainingSec(intervalMinutes * 60)
      // A fresh session drops stale AI questions but keeps hand-written ones
      // (lecturers may prep questions before starting the lecture).
      setCurrentBatch((prev) => prev.filter((q) => q.custom))
    } else if (status === 'idle') {
      setRemainingSec(intervalMinutes * 60)
    }
  }

  // Run the accelerated countdown while actively recording.
  useEffect(() => {
    if (status !== 'recording') return
    const decPerTick = (COUNTDOWN_SPEED * TICK_MS) / 1000
    const timer = window.setInterval(() => {
      setRemainingSec((prev) => {
        const next = prev - decPerTick
        if (next <= 0) {
          doGenerate()
          return intervalMinutes * 60
        }
        return next
      })
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [status, intervalMinutes, doGenerate])

  const addQuestion = useCallback((q: Omit<MCQQuestion, 'id' | 'custom'>) => {
    setCurrentBatch((batch) => [...batch, { ...q, id: `q-user-${Date.now()}`, custom: true }])
  }, [])

  const updateQuestion = useCallback((id: string, patch: Partial<MCQQuestion>) => {
    setCurrentBatch((batch) => batch.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }, [])

  const discardQuestion = useCallback((id: string) => {
    setCurrentBatch((batch) => batch.filter((q) => q.id !== id))
  }, [])

  const sendToProjector = useCallback((q: MCQQuestion) => {
    setSent((prev) => [
      { ...q, sentAt: Date.now(), showing: true },
      ...prev.map((s) => ({ ...s, showing: false })),
    ])
    setCurrentBatch((batch) => batch.filter((item) => item.id !== q.id))

    // Simulate the class answering: deliver mock responses in small batches
    // over a few seconds so the leaderboard visibly fills in live. Driven by
    // timeout callbacks (not a synchronous effect), so the lint rule is happy.
    const all = simulateResponses(q)
    setResponsesByQuestion((prev) => ({ ...prev, [q.id]: [] }))
    setRespondingIds((prev) => [...prev, q.id])

    let i = 0
    const deliver = () => {
      if (i >= all.length) {
        setRespondingIds((prev) => prev.filter((id) => id !== q.id))
        return
      }
      const step = 2 + Math.floor(Math.random() * 3) // 2–4 at a time
      const batch = all.slice(i, i + step)
      i += step
      setResponsesByQuestion((prev) => ({
        ...prev,
        [q.id]: [...(prev[q.id] ?? []), ...batch],
      }))
      window.setTimeout(deliver, 280 + Math.random() * 420)
    }
    window.setTimeout(deliver, 500)
  }, [])

  const setShowing = useCallback((id: string) => {
    setSent((prev) => prev.map((s) => ({ ...s, showing: s.id === id })))
  }, [])

  const removeSent = useCallback((id: string) => {
    setSent((prev) => prev.filter((s) => s.id !== id))
    setResponsesByQuestion((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setRespondingIds((prev) => prev.filter((rid) => rid !== id))
  }, [])

  // Overall class ranking, recomputed as responses arrive.
  const leaderboard = useMemo<LeaderboardEntry[]>(() => {
    const stats = new Map<string, { answered: number; correct: number; timeMs: number }>()
    for (const list of Object.values(responsesByQuestion)) {
      for (const r of list) {
        const s = stats.get(r.studentId) ?? { answered: 0, correct: 0, timeMs: 0 }
        s.answered += 1
        if (r.correct) s.correct += 1
        s.timeMs += r.responseTimeMs
        stats.set(r.studentId, s)
      }
    }
    return CLASS_ROSTER.map((student) => {
      const s = stats.get(student.id)
      const answered = s?.answered ?? 0
      const correct = s?.correct ?? 0
      return {
        student,
        points: correct,
        answered,
        correct,
        accuracy: answered ? Math.round((correct / answered) * 100) : 0,
        avgTimeMs: answered ? Math.round((s?.timeMs ?? 0) / answered) : 0,
      }
    }).sort(
      (a, b) =>
        b.points - a.points ||
        (a.avgTimeMs || Infinity) - (b.avgTimeMs || Infinity) ||
        a.student.name.localeCompare(b.student.name),
    )
  }, [responsesByQuestion])

  return (
    <QuestionContext.Provider
      value={{
        intervalMinutes,
        setIntervalMinutes,
        remainingSec,
        generating,
        currentBatch,
        generateNow,
        addQuestion,
        updateQuestion,
        discardQuestion,
        sent,
        sendToProjector,
        setShowing,
        removeSent,
        responsesByQuestion,
        classSize: CLASS_SIZE,
        leaderboard,
        respondingIds,
      }}
    >
      {children}
    </QuestionContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useQuestions() {
  const ctx = useContext(QuestionContext)
  if (!ctx) throw new Error('useQuestions must be used within QuestionProvider')
  return ctx
}
