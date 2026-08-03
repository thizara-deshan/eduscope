import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  // playwright.config.ts's webServer polls http://127.0.0.1:4173 explicitly;
  // `vite preview`'s default `localhost` binding resolves to a different
  // interface (observed: IPv6 ::1 only) on this machine, so the IPv4 health
  // check never connects even though the server is genuinely up. Binding the
  // preview server to 127.0.0.1 explicitly keeps host and prober in sync.
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
