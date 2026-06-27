/**
 * Vitest "puro" (Node) — dominio y use-cases. Rápido, sin runtime de Workers.
 * Ver skill `tdd-testing` (referencia tooling-setup.md).
 */
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/slices/**/{domain,use-cases}/**/*.test.ts'],
    environment: 'node',
  },
});
