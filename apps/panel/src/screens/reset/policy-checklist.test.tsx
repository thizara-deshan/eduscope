import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PolicyChecklist } from './policy-checklist.js';
import { PASSWORD_RULES } from './password-policy.js';

function Wrapper({ value = '', confirm = '' }: { value?: string; confirm?: string }) {
  return <PolicyChecklist value={value} confirm={confirm} />;
}

describe('PolicyChecklist', () => {
  it('renders one row per rule, with its label', () => {
    render(<Wrapper />);
    for (const rule of PASSWORD_RULES) {
      expect(screen.getByText(rule.label)).toBeInTheDocument();
    }
  });

  it('a met rule shows the check glyph, an unmet rule shows the circle glyph', () => {
    const { rerender } = render(<Wrapper value="Passw0rdd" confirm="Passw0rdd" />);
    const lengthRow = screen.getByText('be 8+ characters').closest('li')!;
    expect(lengthRow.textContent).toContain('✓');
    expect(lengthRow.className).toContain('us-policyrow--met');

    rerender(<Wrapper value="" confirm="" />);
    const unmet = screen.getByText('be 8+ characters').closest('li')!;
    expect(unmet.textContent).toContain('○');
    expect(unmet.className).toContain('us-policyrow--unmet');
  });

  it('the list is aria-live="polite"', () => {
    render(<Wrapper />);
    expect(screen.getByRole('list')).toHaveAttribute('aria-live', 'polite');
  });

  it('typing a compliant password flips all five rows to met', () => {
    const { rerender } = render(<Wrapper value="" confirm="" />);
    rerender(<Wrapper value="Passw0rdd" confirm="Passw0rdd" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.every((r) => r.className.includes('us-policyrow--met'))).toBe(true);
  });

  it('heading reads PASSWORD MUST', () => {
    render(<Wrapper />);
    expect(screen.getByText('PASSWORD MUST')).toBeInTheDocument();
  });
});
