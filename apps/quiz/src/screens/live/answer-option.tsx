import { cn } from '../../lib/utils.js';

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
      className={cn(
        'quiz-answer group flex items-center gap-4 rounded-2xl border-2 bg-surface p-3.5 text-left shadow-sm transition-colors',
        'disabled:opacity-60',
        selected
          ? 'border-primary bg-primary-soft'
          : 'border-border hover:border-primary/40 active:bg-bg',
      )}
      data-state={submitting ? 'submitting' : selected ? 'locked' : 'idle'}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(option.id)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold transition-colors',
          selected ? 'bg-primary text-primary-fg' : 'bg-bg text-muted group-hover:text-primary',
        )}
      >
        {submitting ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary-fg/40 border-t-primary-fg" />
        ) : (
          option.label
        )}
      </span>
      <span className="flex-1 text-lg font-medium leading-snug text-text">{option.text}</span>
      {selected && !submitting && (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-primary" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 10.7a1 1 0 1 1 1.4-1.4l3.1 3.1 6.8-6.8a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  );
}
