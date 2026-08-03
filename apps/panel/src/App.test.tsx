import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('panel shell', () => {
  it('renders the kiosk stage at the fixed panel size', () => {
    render(<App />);
    const panel = screen.getByTestId('us-panel');
    expect(panel).toBeTruthy();
    expect(getComputedStyle(panel).maxWidth).toBe('1280px');
    expect(getComputedStyle(panel).maxHeight).toBe('800px');
  });

  it('makes the panel the positioning context for overlays', () => {
    render(<App />);
    expect(getComputedStyle(screen.getByTestId('us-panel')).position).toBe('relative');
  });
});
