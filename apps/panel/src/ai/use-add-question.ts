import { useCallback, useEffect, useRef, useState } from 'react';
import { ProblemError } from '@eduscope/api-client';
import { TIMERS } from '@eduscope/shared';
import { useClient } from '../client/client-provider.js';
import { useQuestionEvents } from '../store/selectors.js';

const MIN_CHOICES = 2;
const MAX_CHOICES = 4;

export interface UseAddQuestion {
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly correctIndex: number;
  readonly saving: boolean;
  readonly problem: string | null;
  readonly valid: boolean;
  /** The specific INV-Q-1 violation, or null when valid — Save is disabled with this reason shown. */
  readonly invalidReason: string | null;
  readonly canAddChoice: boolean;
  readonly canRemoveChoice: boolean;
  setPrompt(value: string): void;
  setChoice(index: number, value: string): void;
  addChoice(): void;
  removeChoice(index: number): void;
  setCorrectIndex(index: number): void;
  save(): void;
}

function refusalMessage(error: unknown, fallback: string): string {
  if (error instanceof ProblemError) return error.problem.detail ?? error.problem.title;
  return fallback;
}

function invalidReasonFor(prompt: string, choices: readonly string[]): string | null {
  if (prompt.trim() === '') return 'Enter a question.';
  if (choices.length < MIN_CHOICES) return 'Add at least two choices.';
  if (choices.some((c) => c.trim() === '')) return 'Fill in every choice.';
  return null;
}

/**
 * S-15 form model: `createQuestion` (`QuestionCreate`), INV-Q-1 validity,
 * 422/409 rejection (form stays intact on rejection — never reverted), and
 * resolution on the `ai.question{draft, lecturer-authored}` WS echo, which
 * is the caller's cue to close the dialog (`onSaved`).
 */
export function useAddQuestion(onSaved: () => void): UseAddQuestion {
  const client = useClient();
  const questionDeltas = useQuestionEvents();

  const [prompt, setPrompt] = useState('');
  const [choices, setChoices] = useState<string[]>(['', '']);
  const [correctIndex, setCorrectIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ceiling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenAuthoredIds = useRef<Set<string>>(new Set());

  const clearCeiling = useCallback(() => {
    if (ceiling.current !== null) clearTimeout(ceiling.current);
    ceiling.current = null;
  }, []);
  useEffect(() => clearCeiling, [clearCeiling]);

  // Resolve on the first NEW lecturer-authored draft echo seen while saving.
  useEffect(() => {
    if (!saving) return;
    for (const [id, delta] of Object.entries(questionDeltas)) {
      if (delta.provenance !== 'lecturer-authored' || delta.state !== 'draft') continue;
      if (seenAuthoredIds.current.has(id)) continue;
      seenAuthoredIds.current.add(id);
      clearCeiling();
      setSaving(false);
      onSaved();
      return;
    }
  }, [clearCeiling, onSaved, questionDeltas, saving]);

  const invalidReason = invalidReasonFor(prompt, choices);
  const valid = invalidReason === null;

  const save = useCallback(() => {
    if (saving || !valid) return;
    for (const id of Object.keys(questionDeltas)) seenAuthoredIds.current.add(id);
    setProblem(null);
    setSaving(true);
    clearCeiling();
    ceiling.current = setTimeout(() => {
      ceiling.current = null;
      setSaving(false);
      setProblem('This did not resolve in time.');
    }, TIMERS['T-CMD-RESOLVE']);

    void client.createQuestion({
      prompt: prompt.trim(),
      options: choices.map((text, i) => ({ text: text.trim(), isCorrect: i === correctIndex })),
    }).catch((error: unknown) => {
      clearCeiling();
      setSaving(false);
      setProblem(refusalMessage(error, 'Could not save the question.'));
    });
  }, [choices, clearCeiling, client, correctIndex, prompt, questionDeltas, saving, valid]);

  const setChoice = useCallback((index: number, value: string) => {
    setChoices((cs) => cs.map((c, i) => (i === index ? value : c)));
  }, []);

  const addChoice = useCallback(() => {
    setChoices((cs) => (cs.length >= MAX_CHOICES ? cs : [...cs, '']));
  }, []);

  const removeChoice = useCallback((index: number) => {
    setChoices((cs) => (cs.length <= MIN_CHOICES ? cs : cs.filter((_, i) => i !== index)));
    setCorrectIndex((prev) => (index === prev ? 0 : index < prev ? prev - 1 : prev));
  }, []);

  return {
    prompt,
    choices,
    correctIndex,
    saving,
    problem,
    valid,
    invalidReason,
    canAddChoice: choices.length < MAX_CHOICES,
    canRemoveChoice: choices.length > MIN_CHOICES,
    setPrompt,
    setChoice,
    addChoice,
    removeChoice,
    setCorrectIndex,
    save,
  };
}
