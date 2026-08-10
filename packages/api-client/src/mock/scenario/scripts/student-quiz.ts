import type { ScenarioScript } from '../types.js';

export const studentQuizHappy: ScenarioScript = {
  name: 'student-quiz-happy',
  description: 'Wave 7 happy path: anonymous join, created participant, four-option question, accepted correct answer, current rank and participated summary.',
  forced: [],
  studentQuiz: {
    resolution: 'open-anonymous', registration: 'created', question: 'open-4',
    answer: 'accepted', result: 'correct-current', summary: 'participated', reconnect: false,
  },
};

export const studentQuizReturning: ScenarioScript = {
  name: 'student-quiz-returning',
  description: 'Wave 7 returning path: cookie-recognized rejoin, three-option question, duplicate answer, incorrect result and pending rank.',
  forced: [],
  studentQuiz: {
    resolution: 'open-returning', registration: 'rejoined', question: 'open-3',
    answer: 'already-accepted', result: 'incorrect-pending', summary: 'participated', reconnect: false,
  },
};

export const studentQuizClosed: ScenarioScript = {
  name: 'student-quiz-closed',
  description: 'Wave 7 terminal path: closed resolution/registration race, closed question refusal and never-answered zero summary.',
  forced: [],
  studentQuiz: {
    resolution: 'closed', registration: 'session-closed', question: 'closed',
    answer: 'question-closed', result: 'none', summary: 'none', reconnect: false,
  },
};

export const studentQuizReconnect: ScenarioScript = {
  name: 'student-quiz-reconnect',
  description: 'Wave 7 offline/reconnect path: atomic replacement snapshot with a two-option question and a missed result.',
  forced: [],
  studentQuiz: {
    resolution: 'open-returning', registration: 'offline-once', question: 'open-2',
    answer: 'accepted', result: 'missed-current', summary: 'participated', reconnect: true,
  },
};

export const studentQuizFailures: ScenarioScript = {
  name: 'student-quiz-failures',
  description: 'Wave 7 service failure path: unreachable resolution with retry, unavailable registration, invalid-code/option refusals and request/reply loss.',
  forced: [],
  studentQuiz: {
    resolution: 'unreachable-once', registration: 'unavailable', question: 'none',
    answer: 'reply-lost', result: 'none', summary: 'open', reconnect: false,
  },
};
