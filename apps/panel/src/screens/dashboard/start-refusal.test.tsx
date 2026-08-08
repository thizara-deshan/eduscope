import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Problem, UserRole } from '@eduscope/shared';
import { StartRefusal } from './start-refusal.js';

const renderRefusal = (problem: Problem, role: UserRole = 'admin') => render(
  <MemoryRouter><StartRefusal problem={problem} role={role} /></MemoryRouter>,
);

describe('StartRefusal', () => {
  it.each([
    ['provisioning.incomplete', '/advanced/device'],
    ['volume.unavailable', '/advanced/storage'],
    ['storage.critical', '/advanced/storage'],
    ['config.invalid', '/advanced/local-capture'],
  ] as const)('%s renders its named copy and admin remedy', (code, target) => {
    renderRefusal({ status: 409, code, title: `Named ${code}`, detail: `Detail ${code}` });
    expect(screen.getByText(`Named ${code}`)).toBeInTheDocument();
    expect(screen.getByText(`Detail ${code}`)).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', target);
  });

  it('shows no fixing-screen jump to a lecturer', () => {
    renderRefusal({ status: 409, code: 'config.invalid', title: 'Invalid layout' }, 'lecturer');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
