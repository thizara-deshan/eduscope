import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Question } from '@eduscope/shared';
import '../../styles/tokens.css';
import { QuestionCard } from './question-card.js';

const question = (overrides: Partial<Question> = {}): Question => ({
  id: 'q1', sessionId: 'sess1', questionSetId: 'set1', kind: 'mcq',
  prompt: 'Which traversal visits a node before its children?', options: [
    { id: 'o1', questionId: 'q1', label: 'A', text: 'Pre-order', position: 0 },
    { id: 'o2', questionId: 'q1', label: 'B', text: 'In-order', position: 1 },
  ], correctOptionId: 'o1', provenance: 'generated', edited: false, state: 'draft',
  createdAt: '2026-08-05T10:00:00Z', orderHint: 0, ...overrides,
});

function renderCard(props: Partial<Parameters<typeof QuestionCard>[0]> = {}) {
  const onEdit = vi.fn();
  const onDiscard = vi.fn();
  const onSend = vi.fn();
  const defaults = {
    question: question(), pendingId: null, pendingKind: null, problem: null,
    canSend: true, sendRefusalReason: null, onEdit, onDiscard, onSend,
  };
  render(<ul><QuestionCard {...defaults} {...props} /></ul>);
  return { onEdit, onDiscard, onSend };
}

describe('QuestionCard', () => {
  it('collapsed by default', () => {
    renderCard();
    expect(screen.queryByText('A. Pre-order')).toBeNull();
  });

  it('expands to show the correct option marked and a Yours chip for lecturer-authored', () => {
    renderCard({ question: question({ provenance: 'lecturer-authored' }) });
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('A. Pre-order').closest('li')).toHaveClass('us-qcard__option--correct');
    expect(screen.getByText('Yours')).toBeInTheDocument();
  });

  it('editing: tap-a-letter changes the correct answer, then Save calls onEdit', () => {
    const { onEdit } = renderCard();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'B. In-order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onEdit).toHaveBeenCalledWith('q1', {
      prompt: 'Which traversal visits a node before its children?',
      options: [
        { id: 'o1', text: 'Pre-order', isCorrect: false },
        { id: 'o2', text: 'In-order', isCorrect: true },
      ],
    });
  });

  it('discarding: the button reads Discarding… while pending', () => {
    renderCard({ pendingId: 'q1', pendingKind: 'discarding' });
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { name: 'Discarding…' })).toBeDisabled();
  });

  it('sending: disabled with a reason when the quiz is unavailable', () => {
    renderCard({ canSend: false, sendRefusalReason: 'Students cannot receive this question right now.' });
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByRole('button', { name: 'Send to Projector' })).toBeDisabled();
    expect(screen.getByText('Students cannot receive this question right now.')).toBeInTheDocument();
  });

  it('sending: enabled and issues onSend when the quiz is open', () => {
    const { onSend } = renderCard();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Projector' }));
    expect(onSend).toHaveBeenCalledWith('q1');
  });

  it('edit refused (immutable): a sent question can still be attempted, and shows the reason', () => {
    renderCard({
      question: question({ state: 'sent' }),
      problem: 'Only draft questions can be edited',
    });
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    // sent questions offer Edit but no Discard/Send
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.getByTestId('question-card-q1-problem')).toHaveTextContent('Only draft questions can be edited');
  });
});
