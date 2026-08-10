import type { ScenarioScript } from '../types.js';

export const studentQuizHappy: ScenarioScript = {
  name: 'student-quiz-happy',
  description: 'Wave 7 happy path: anonymous join, created participant, four-option open question awaiting an answer.',
  forced: [],
  studentQuiz: {
    resolution: 'open-anonymous', registration: 'created', question: 'open-4',
    answer: 'accepted', result: 'none', summary: 'open', reconnect: false,
    restDelayMs: { resolveJoinCode: 400, registerParticipant: 400, submitAnswer: 400 },
  },
};

export const studentQuizReturning: ScenarioScript = {
  name: 'student-quiz-returning',
  description: 'Wave 7 returning path: cookie-recognized rejoin, three-option question with a duplicate answer already stored.',
  forced: [],
  studentQuiz: {
    resolution: 'open-returning', registration: 'rejoined', question: 'open-3',
    answer: 'already-accepted', result: 'none', summary: 'open', reconnect: false,
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
  description: 'Wave 7 service failure path: unreachable resolution with retry, unavailable registration, open question for reply-loss coverage.',
  forced: [],
  studentQuiz: {
    resolution: 'unreachable-once', registration: 'unavailable', question: 'open-4',
    answer: 'reply-lost', result: 'none', summary: 'open', reconnect: false,
  },
};

export const studentQuizRegistrationClosed: ScenarioScript = {
  name: 'student-quiz-registration-closed',
  description: 'Wave 7 S-38 race: the code still resolves open/anonymous, but the session closed a moment earlier — registration refuses, and /s/{id} already shows the closed S-41 terminal.',
  forced: [],
  studentQuiz: {
    resolution: 'open-anonymous', registration: 'session-closed', question: 'none',
    answer: 'accepted', result: 'none', summary: 'none', reconnect: false,
  },
};

export const studentQuizLateAnswer: ScenarioScript = {
  name: 'student-quiz-late-answer',
  description: 'Wave 7 S-39 late refusal: the session and question stay visibly open while submitAnswer refuses with question.closed.',
  forced: [],
  studentQuiz: {
    resolution: 'open-returning', registration: 'rejoined', question: 'open-4',
    answer: 'question-closed', result: 'none', summary: 'open', reconnect: false,
  },
};

export const studentQuizSessionNotFound: ScenarioScript = {
  name: 'student-quiz-session-not-found',
  description: 'Wave 7 S-41 direct-session boot: connect() rejects with quiz.session-not-found for a stale/invalid link.',
  forced: [],
  studentQuiz: {
    resolution: 'open-anonymous', registration: 'created', question: 'open-4',
    answer: 'accepted', result: 'none', summary: 'open', reconnect: false,
    connectOutcome: 'session-not-found',
  },
};
