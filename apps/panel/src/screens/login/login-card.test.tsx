import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoginCard } from './login-card.js';
// happy-dom has no layout engine and cannot resolve calc()/clamp() against a
// custom property (verified empirically — getComputedStyle returns ''), so the
// collapse mechanism itself is asserted against the stylesheet text here; the
// real pixel number is Playwright's job (S-01 §13, Task 17).
import loginCss from './login.css?raw';

function renderCard() {
  return render(
    <div className="us-panel" data-testid="us-panel">
      <LoginCard
        message={null}
        fields={<input aria-label="Username" />}
        action={<button type="submit">Log In</button>}
      />
    </div>,
  );
}

describe('LoginCard', () => {
  it('renders the title "Welcome back" and the subtitle "Sign in to your recording panel"', () => {
    renderCard();
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByText('Sign in to your recording panel')).toBeInTheDocument();
  });

  it('renders fields and action, with the message slot between them', () => {
    renderCard();
    const body = document.querySelector('.us-login__body') as HTMLElement;
    const children = Array.from(body.children);
    const fieldsIdx = children.findIndex((c) => c.className === 'us-login__fields');
    const messageIdx = children.findIndex((c) => c.getAttribute('data-testid') === 'auth-message');
    const actionIdx = children.findIndex((c) => c.tagName === 'BUTTON');
    expect(fieldsIdx).toBeGreaterThanOrEqual(0);
    expect(messageIdx).toBeGreaterThan(fieldsIdx);
    expect(actionIdx).toBeGreaterThan(messageIdx);
  });

  it('the message slot is present when message is null (S01-D-4)', () => {
    renderCard();
    expect(screen.getByTestId('auth-message')).toBeInTheDocument();
  });

  it('has no role picker: no element with an accessible name matching /lecturer|administrator/i', () => {
    renderCard();
    expect(screen.queryByText(/lecturer|administrator/i)).toBeNull();
  });

  it('the band renders with a non-zero declared height, collapsing to 0 via --osk-h (S01-D-2)', () => {
    renderCard();
    const band = document.querySelector('.us-login__band') as HTMLElement;
    expect(band).toBeInTheDocument();
    // The exact pixel resolution of calc()/clamp() against a custom property
    // needs a real layout engine (Playwright, Task 17); here the mechanism is
    // asserted directly: the band's height is driven by --osk-h and clamps to
    // exactly 0 at its upper bound.
    const rule = loginCss.match(/\.us-login__band\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/height:\s*clamp\(0px,\s*calc\(82px - var\(--osk-h/);
  });

  it("the card's computed width is 420px", () => {
    renderCard();
    const card = document.querySelector('.us-login__card') as HTMLElement;
    expect(getComputedStyle(card).width).toBe('420px');
  });
});
