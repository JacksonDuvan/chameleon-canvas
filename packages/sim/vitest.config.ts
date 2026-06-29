/**
 * Vitest del kernel de simulación: tests PUROS (Node), rápidos, sin WASM ni runtime
 * de Workers. El MVP del Paso 2 (movimiento, captura, fases, determinismo) se prueba
 * aquí. Skill `tdd-testing`.
 */
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
