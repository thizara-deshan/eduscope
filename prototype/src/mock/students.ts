import type { MCQQuestion, Student, StudentResponse } from '../types'

// A mock class roster. Names are generic; initials drive the avatar chips.
const NAMES = [
  'Aisha Khan',
  'Ben Carter',
  'Chloe Adams',
  'Diego Morales',
  'Ella Novak',
  'Farhan Ali',
  'Grace Lin',
  'Hassan Omar',
  'Isabella Rossi',
  'Jack Nguyen',
  'Kavya Patel',
  'Liam Murphy',
  'Mia Andersson',
  'Noah Bright',
  'Olivia Chen',
  'Priya Sharma',
  'Quinn Taylor',
  'Ravi Menon',
  'Sofia Garcia',
  'Tom Whitaker',
  'Uma Reddy',
  'Wei Zhang',
]

const initialsOf = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

export const CLASS_ROSTER: Student[] = NAMES.map((name, i) => ({
  id: `s-${i}`,
  name,
  initials: initialsOf(name),
}))

export const CLASS_SIZE = CLASS_ROSTER.length

const BY_ID = new Map(CLASS_ROSTER.map((s) => [s.id, s]))
/** Look up a roster entry by id. */
export const getStudent = (id: string): Student | undefined => BY_ID.get(id)

/**
 * Produce a realistic mix of answers for one question: most students get it
 * right, a minority pick a wrong option, and a few don't answer at all.
 * Response times are spread out so "fastest correct" is meaningful.
 */
export function simulateResponses(question: MCQQuestion): StudentResponse[] {
  const responses: StudentResponse[] = []
  const wrongOptions = question.options.map((_, i) => i).filter((i) => i !== question.correctIndex)

  for (const student of CLASS_ROSTER) {
    // ~12% of the class doesn't respond.
    if (Math.random() < 0.12) continue

    // ~72% of responders answer correctly.
    const correct = Math.random() < 0.72
    const optionIndex = correct
      ? question.correctIndex
      : wrongOptions[Math.floor(Math.random() * wrongOptions.length)] ?? question.correctIndex

    responses.push({
      studentId: student.id,
      optionIndex,
      correct,
      responseTimeMs: Math.round(2500 + Math.random() * 22000), // 2.5s–24.5s
    })
  }

  // Deliver in the order students actually answered (fastest first).
  return responses.sort((a, b) => a.responseTimeMs - b.responseTimeMs)
}
