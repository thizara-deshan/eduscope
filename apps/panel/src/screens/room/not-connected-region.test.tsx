import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NotConnectedRegion, ROOM_HARDWARE } from './not-connected-region.js';

function renderRegion() {
  return render(<NotConnectedRegion title="NOT CONNECTED" items={ROOM_HARDWARE} />);
}

describe('NotConnectedRegion', () => {
  it('announces one factual notice before the five static hardware names', () => {
    renderRegion();
    const region = screen.getByRole('region', { name: /not connected/i });

    expect(region.firstElementChild).toHaveTextContent('These are not wired to this device.');
    expect(within(region).getByText('Projector')).toBeInTheDocument();
    expect(within(region).getByText('Projector Screen')).toBeInTheDocument();
    expect(within(region).getByText('Speaker Volume')).toBeInTheDocument();
    expect(within(region).getByText('Lights')).toBeInTheDocument();
    expect(within(region).getByLabelText('Air conditioning')).toHaveTextContent('A/C');
  });

  it('renders no interactive role anywhere inside the region', () => {
    renderRegion();
    const region = screen.getByRole('region', { name: /not connected/i });
    for (const role of ['button', 'switch', 'checkbox', 'link', 'slider'] as const) {
      expect(within(region).queryAllByRole(role)).toHaveLength(0);
    }
    expect(region.querySelectorAll('button, input, [tabindex], [role="switch"]')).toHaveLength(0);
  });

  it('makes no state claim about absent hardware', () => {
    renderRegion();
    const region = screen.getByRole('region', { name: /not connected/i });
    expect(region.textContent).not.toMatch(/\b(on|off|lowered|raised|\d+%|\d+°C)\b/i);
  });
});
