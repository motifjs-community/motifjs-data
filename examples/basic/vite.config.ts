import compiler from '@motifx/compiler';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// The example imports the package by its published name, resolved to the source here,
// so it always runs against the current code without a build step.
export default defineConfig({
  base: './',
  plugins: [compiler()],
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    alias: { '@motifx-community/data': fileURLToPath(new URL('../../src/index.ts', import.meta.url)) },
    dedupe: ['@motifx/core'],
  },
  // The design system is linked from the sibling folder; let the dev server read its fonts.
  server: {
    port: 5181,
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url)), fileURLToPath(new URL('../../../motifjs-design-system', import.meta.url))],
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
