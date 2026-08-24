/**
 * DM-10 ranking, shared by core-api's panel leaderboard and the quiz-service
 * student stream (Workstream D master-plan gate flag) so B and D never carry
 * two independent implementations of the same rule: `points = 10 × correct`
 * (INT-2), `accuracy = correct / answered` (0 when answered is 0, never
 * `NaN`), and dense ranking so ties share a rank (INV-LB-2).
 */
export interface QuizScoreInput {
  studentIdNumber: string;
  displayName: string;
  answered: number;
  correct: number;
  responseMsTotal: number;
}

export interface ScoredQuizParticipant extends QuizScoreInput {
  points: number;
  accuracy: number;
  avgResponseMs: number;
  rank: number;
}

export function scoreQuizParticipants(
  inputs: readonly QuizScoreInput[],
): ScoredQuizParticipant[] {
  const sorted = inputs
    .map((row) => ({
      ...row,
      points: row.correct * 10,
      accuracy: row.answered === 0 ? 0 : row.correct / row.answered,
      avgResponseMs: row.answered === 0 ? 0 : Math.round(row.responseMsTotal / row.answered),
      rank: 0,
    }))
    .sort((a, b) => b.points - a.points || a.studentIdNumber.localeCompare(b.studentIdNumber));

  let rank = 0;
  let priorPoints: number | null = null;
  return sorted.map((row) => {
    if (priorPoints === null || priorPoints !== row.points) rank += 1;
    priorPoints = row.points;
    return { ...row, rank };
  });
}
