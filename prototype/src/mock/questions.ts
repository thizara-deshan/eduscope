import type { MCQQuestion } from '../types'

// A pool of mock MCQs. Each "generation" draws a small batch from here so the
// prototype feels alive without any real AI. Topics are generic on purpose.

let counter = 0
const nextId = () => `q-${Date.now()}-${counter++}`

const POOL: Omit<MCQQuestion, 'id'>[] = [
  {
    prompt: 'Which data structure uses First-In-First-Out (FIFO) ordering?',
    options: ['Stack', 'Queue', 'Binary Tree', 'Hash Map'],
    correctIndex: 1,
  },
  {
    prompt: 'What is the time complexity of binary search on a sorted array?',
    options: ['O(n)', 'O(n log n)', 'O(log n)', 'O(1)'],
    correctIndex: 2,
  },
  {
    prompt: 'In supply and demand, what typically happens to price when supply rises and demand stays constant?',
    options: ['Price rises', 'Price falls', 'Price is unchanged', 'Demand disappears'],
    correctIndex: 1,
  },
  {
    prompt: 'Which planet in our solar system has the strongest surface gravity?',
    options: ['Earth', 'Saturn', 'Jupiter', 'Neptune'],
    correctIndex: 2,
  },
  {
    prompt: 'What is the primary function of mitochondria in a cell?',
    options: ['Protein synthesis', 'Energy (ATP) production', 'Waste removal', 'Cell division'],
    correctIndex: 1,
  },
  {
    prompt: 'Which of these is a renewable source of energy?',
    options: ['Coal', 'Natural gas', 'Solar', 'Petroleum'],
    correctIndex: 2,
  },
  {
    prompt: 'In grammar, which word class describes an action or state?',
    options: ['Noun', 'Verb', 'Adjective', 'Preposition'],
    correctIndex: 1,
  },
  {
    prompt: 'What does the acronym "HTTP" stand for?',
    options: [
      'HyperText Transfer Protocol',
      'High Transfer Text Program',
      'Hyperlink Transmission Type Protocol',
      'Host Transfer Text Protocol',
    ],
    correctIndex: 0,
  },
  {
    prompt: 'Which theorem relates the sides of a right-angled triangle?',
    options: ["Fermat's theorem", 'Pythagorean theorem', "Bayes' theorem", 'Central limit theorem'],
    correctIndex: 1,
  },
  {
    prompt: 'What is the chemical symbol for sodium?',
    options: ['So', 'Sd', 'Na', 'S'],
    correctIndex: 2,
  },
  {
    prompt: 'In project management, what does a "milestone" represent?',
    options: [
      'A daily stand-up meeting',
      'A significant checkpoint or event',
      'A budget overrun',
      'A type of software bug',
    ],
    correctIndex: 1,
  },
  {
    prompt: 'Which layer of the OSI model is responsible for routing?',
    options: ['Physical', 'Data link', 'Network', 'Application'],
    correctIndex: 2,
  },
]

/**
 * Produce a fresh batch of 3–5 mock MCQs with unique ids.
 * Shuffles the pool so successive generations feel varied.
 */
export function generateQuestionBatch(): MCQQuestion[] {
  const size = 3 + Math.floor(Math.random() * 3) // 3, 4, or 5
  const shuffled = [...POOL].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, size).map((q) => ({ ...q, id: nextId() }))
}
