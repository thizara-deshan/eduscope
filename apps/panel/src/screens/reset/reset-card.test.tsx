import { render, screen, cleanup } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../styles/tokens.css';
import '../../styles/app.css';
import { ResetCard } from './reset-card.js';

function renderCard(mode: 'forced' | 'voluntary' = 'forced') {
  return render(
    <ResetCard
      mode={mode}
      headerAction={<button type="button">{mode === 'forced' ? 'Sign out' : 'Cancel'}</button>}
      fields={<div data-testid="fields">fields</div>}
      reason={<p data-testid="reason">Your account was created by an administrator.</p>}
      checklist={<div data-testid="checklist">checklist</div>}
      message={<div data-testid="message" />}
      action={<button type="submit">Set password</button>}
    />,
  );
}

describe('ResetCard', () => {
  it("the card's computed width is 680px", () => {
    renderCard();
    const card = document.querySelector('.us-reset__card') as HTMLElement;
    expect(getComputedStyle(card).width).toBe('680px');
  });

  it('forced renders the reason block; voluntary does not', () => {
    renderCard('forced');
    expect(screen.getByTestId('reason')).toBeInTheDocument();
    cleanup();
    renderCard('voluntary');
    expect(screen.queryByTestId('reason')).toBeNull();
  });

  it('renders all seven slots, with the submit inside the right column', () => {
    renderCard();
    expect(screen.getByTestId('fields')).toBeInTheDocument();
    expect(screen.getByTestId('checklist')).toBeInTheDocument();
    expect(screen.getByTestId('message')).toBeInTheDocument();
    const rightColumn = document.querySelector('.us-reset__col--right') as HTMLElement;
    const leftColumn = document.querySelector('.us-reset__col--left') as HTMLElement;
    expect(rightColumn.contains(screen.getByRole('button', { name: 'Set password' }))).toBe(true);
    expect(leftColumn.contains(screen.getByTestId('fields'))).toBe(true);
  });

  it('title reads "Set a new password"', () => {
    renderCard();
    expect(screen.getByText('Set a new password')).toBeInTheDocument();
  });

  it("the header action slot's element is >=44px", () => {
    renderCard();
    const header = screen.getByRole('button', { name: 'Sign out' });
    expect(getComputedStyle(header).minHeight).toBe('44px');
  });
});
