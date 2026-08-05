import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { StartState } from './use-start-recording.js';
import { IdleHero } from './idle-hero.js';

const renderHero = (state: StartState) => render(
  <MemoryRouter>
    <IdleHero name="A. Perera" userRole="lecturer" state={state} onStart={vi.fn()} onDismiss={vi.fn()} />
  </MemoryRouter>,
);

describe('IdleHero', () => {
  it('renders ready with one enabled Start pill', () => {
    renderHero({ kind: 'ready' });
    expect(screen.getByRole('button', { name: 'Start Recording' })).toBeEnabled();
  });

  it('renders starting as pending without replacing the pill geometry', () => {
    renderHero({ kind: 'starting' });
    const button = screen.getByRole('button', { name: 'Starting…' });
    expect(button).toBeDisabled();
    expect(button).toHaveClass('us-hero__start');
  });

  it('renders a refused reason as text and disables Start', () => {
    renderHero({ kind: 'refused', problem: { status: 409, code: 'config.invalid', title: 'Students Camera is missing' } });
    const button = screen.getByRole('button', { name: 'Start Recording' });
    expect(button).toBeDisabled();
    expect(screen.getByText('Students Camera is missing')).toBeInTheDocument();
    expect(button).not.toHaveAttribute('title');
  });

  it('holds cold load with rendered text', () => {
    renderHero({ kind: 'holding', reason: 'cold' });
    expect(screen.getByText('Checking recording status')).toBeInTheDocument();
    expect(screen.getByRole('button')).not.toHaveAttribute('title');
  });

  it('holds recovery with the specified rendered text', () => {
    renderHero({ kind: 'holding', reason: 'recovery' });
    expect(screen.getByText('Checking the previous session')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders offline beside a disabled command', () => {
    renderHero({ kind: 'offline' });
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
