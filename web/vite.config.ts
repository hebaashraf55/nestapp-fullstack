/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :5000 and is reached through the proxy, so the browser sees one origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:5000' } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/main.tsx'] },
  },
});
