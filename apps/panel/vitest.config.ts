import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'panel',
    // happy-dom, not jsdom: jsdom does not resolve CSS custom properties
    // (var(--x)) in getComputedStyle — a known, unfixed limitation — which
    // breaks every computed-style assertion against a design token.
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: true, // tokens.css must be applied for the computed-style assertions
  },
});
