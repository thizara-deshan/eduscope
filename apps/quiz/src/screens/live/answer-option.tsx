export function AnswerOption({
  option,
  selected,
  submitting,
  disabled,
  onSelect,
}: {
  option: { id: string; label: string; text: string };
  selected: boolean;
  submitting: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="quiz-answer"
      data-state={submitting ? 'submitting' : selected ? 'locked' : 'idle'}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(option.id)}
    >
      <span className="quiz-answer__label">{option.label}</span>
      <span className="quiz-answer__text">{option.text}</span>
    </button>
  );
}
