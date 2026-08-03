import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'quiz',
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test-setup.ts'],
    include: ['{app,src}/**/*.test.{ts,tsx}'],
  },
});
