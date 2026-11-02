/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Tests against public demo services. They need the network, so `npm run check` does not run them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
