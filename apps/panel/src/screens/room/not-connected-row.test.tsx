import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotConnectedRow } from './not-connected-row.js';

describe('NotConnectedRow', () => {
  it('renders only an icon and name, with no control semantics', () => {
    const { container } = render(
      <NotConnectedRow icon={<svg aria-hidden="true" />} name="Projector" />,
    );

    expect(screen.getByText('Projector')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
    expect(container.querySelector('button, input, [tabindex], [aria-disabled]')).toBeNull();
  });
});
