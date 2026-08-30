import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Stamps a unique cache version into the built service worker. Every build gets
 * a fresh cache name, so an installed PWA cannot keep serving old code after a
 * deploy — the single most repeated pain point in the original (spec §14).
 */
function stampServiceWorker() {
  return {
    name: 'checkin-stamp-sw',
    apply: 'build',
    closeBundle() {
      const file = resolve(__dirname, 'dist/sw.js');
      if (!existsSync(file)) return;
      const version = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll('__SW_VERSION__', version));
      this.info?.(`service worker cache version: ${version}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
});
