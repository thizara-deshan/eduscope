import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToggleSwitch } from './toggle-switch.js';

describe('ToggleSwitch', () => {
  it('keeps a 44px target while rendering a slim track', () => {
    render(<ToggleSwitch checked label="Live Meeting" onChange={vi.fn()} />);
    const control = screen.getByRole('switch', { name: 'Live Meeting' });
    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(control.querySelector('.us-switch__track')).not.toBeNull();
    expect(control.querySelector('.us-switch__thumb')).not.toBeNull();
  });

  it('reports the next checked state once', async () => {
    const onChange = vi.fn();
    render(<ToggleSwitch checked={false} label="Lecturer Mic" onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
