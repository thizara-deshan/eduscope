import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scoreQuizParticipants } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useRecordingSession, useResponsesEvent } from '../store/selectors.js';
import { AI_KEYS } from './query-keys.js';
import { useQuizSession } from './use-quiz-session.js';

export interface LeaderboardEntryView {
  readonly studentIdNumber: string;
  readonly displayName: string;
  readonly answered: number;
  readonly correct: number;
  /** DM-10: score = correct × 10 (INT-2). */
  readonly points: number;
  /** correct/answered; 0 when answered = 0 (INV-QP-2) — never treated as incorrect. */
  readonly accuracy: number;
  /** Insight only — never affects score or rank (INT-2, QZ-5). */
  readonly avgResponseMs: number;
  /** Ties share a rank (INV-LB-2). */
  readonly rank: number;
}

export interface UseLeaderboard {
  readonly loading: boolean;
  readonly entries: readonly LeaderboardEntryView[];
  readonly stale: boolean;
  /** A live dot: at least one response has streamed in this session. */
  readonly live: boolean;
  readonly quizUnavailable: boolean;
}

interface Tally {
  displayName: string;
  answered: number;
  correct: number;
  totalResponseMs: number;
}

/**
 * S-17 model: `getLeaderboard` snapshot recomputed on `quiz.responses`
 * (W4-D-5) — the REST rows seed a per-student tally, each live delta batch
 * folds in additively (every delta is one NEW answer event, never a
 * cumulative resend), and rank/score/accuracy are re-derived from the merged
 * tallies on every render. Nothing computed here is ever written back
 * (INV-LB-1, "derived, never stored").
 */
export function useLeaderboard(): UseLeaderboard {
  const client = useClient();
  const session = useRecordingSession();
  const sessionId = session?.sessionId ?? undefined;
  const quiz = useQuizSession();
  const responsesEvent = useResponsesEvent();

  const query = useQuery({
    queryKey: AI_KEYS.leaderboard(sessionId),
    queryFn: () => client.getLeaderboard({ sessionId: sessionId! }),
    enabled: sessionId !== undefined,
  });

  const [liveDeltas, setLiveDeltas] = useState<Record<string, Tally>>({});
  const [live, setLive] = useState(false);
  const [wsStale, setWsStale] = useState<boolean | null>(null);
  const lastProcessed = useRef<string | null>(null);

  useEffect(() => {
    if (!responsesEvent) return;
    const key = `${responsesEvent.publicationId}:${responsesEvent.syncedAt}:${responsesEvent.deltas.length}`;
    if (lastProcessed.current === key) return;
    lastProcessed.current = key;
    setWsStale(responsesEvent.stale);
    if (responsesEvent.deltas.length === 0) return;
    setLive(true);
    setLiveDeltas((prev) => {
      const next = { ...prev };
      for (const delta of responsesEvent.deltas) {
        const existing = next[delta.studentIdNumber] ?? {
          displayName: delta.displayName, answered: 0, correct: 0, totalResponseMs: 0,
        };
        next[delta.studentIdNumber] = {
          displayName: delta.displayName,
          answered: existing.answered + 1,
          correct: existing.correct + (delta.isCorrect ? 1 : 0),
          totalResponseMs: existing.totalResponseMs + delta.responseTimeMs,
        };
      }
      return next;
    });
  }, [responsesEvent]);

  const merged = new Map<string, Tally>();
  for (const row of query.data?.entries ?? []) {
    merged.set(row.studentIdNumber, {
      displayName: row.displayName,
      answered: row.answered,
      correct: row.correct,
      totalResponseMs: row.avgResponseMs * row.answered,
    });
  }
  for (const [studentIdNumber, delta] of Object.entries(liveDeltas)) {
    const existing = merged.get(studentIdNumber) ?? {
      displayName: delta.displayName, answered: 0, correct: 0, totalResponseMs: 0,
    };
    merged.set(studentIdNumber, {
      displayName: delta.displayName,
      answered: existing.answered + delta.answered,
      correct: existing.correct + delta.correct,
      totalResponseMs: existing.totalResponseMs + delta.totalResponseMs,
    });
  }

  // DM-10: the panel scores and dense-ranks through the same shared helper B
  // and D use, so all three agree on ties (INV-LB-2) — never a third local
  // formula that could drift (e.g. standard vs dense ranking).
  const entries: LeaderboardEntryView[] = scoreQuizParticipants(
    [...merged.entries()].map(([studentIdNumber, t]) => ({
      studentIdNumber,
      displayName: t.displayName,
      answered: t.answered,
      correct: t.correct,
      responseMsTotal: t.totalResponseMs,
    })),
  );

  return {
    loading: query.isPending && sessionId !== undefined,
    entries,
    stale: wsStale ?? query.data?.stale ?? false,
    live,
    quizUnavailable: quiz.state === 'absent' || quiz.state === 'failed',
  };
}
