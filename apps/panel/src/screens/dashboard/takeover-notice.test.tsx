import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TAKEOVER_REVOKED_SENTENCE } from '../../auth/session.js';
import { TakeoverNotice } from './takeover-notice.js';

describe('TakeoverNotice', () => {
  it('attributes a new owner without rewriting the prior owner', () => {
    render(<TakeoverNotice
      kind="new-owner"
      priorOwnerDisplayName="A. Perera"
      byDisplayName={null}
      at="2026-08-05T14:12:00"
    />);
    expect(screen.getByText(/You took over this recording from A\. Perera at 14:12/i)).toBeInTheDocument();
    expect(screen.getByText(/still saved as their lecture/i)).toBeInTheDocument();
  });

  it('uses the shared takeover-revocation sentence byte-for-byte for a displaced owner', () => {
    render(<TakeoverNotice
      kind="displaced"
      priorOwnerDisplayName={null}
      byDisplayName="R. Fernando"
      at="2026-08-05T14:12:00"
    />);
    const notice = screen.getByTestId('takeover-notice');
    expect(notice.textContent?.startsWith(TAKEOVER_REVOKED_SENTENCE)).toBe(true);
    expect(notice).toHaveTextContent(/You can no longer pause or stop this lecture/i);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
