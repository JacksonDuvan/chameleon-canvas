/**
 * Vitest "puro" (Node) — dominio y use-cases. Rápido, sin runtime de Workers.
 * Ver skill `tdd-testing` (referencia tooling-setup.md).
 */
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Capas puras (node, rápido): dominio, use-cases y adaptadores SIN runtime de Workers.
    include: [
      'src/slices/**/{domain,use-cases}/**/*.test.ts',
      'src/slices/**/infrastructure/adapters/**/*.test.ts',
    ],
    environment: 'node',
  },
});
