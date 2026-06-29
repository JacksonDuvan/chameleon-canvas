/**
 * Vitest del frontend: tests de la lógica netcode del cliente (worldStore, predicción,
 * reconciliación, interpolación) FUERA de React (node). Skill `tdd-testing`: no se
 * testea `useFrame` ni el render; se testea la lógica pura extraída de los hooks.
 *
 * Config separada de `vite.config.ts` (que lleva los plugins de TanStack Start +
 * Cloudflare) para no arrastrarlos al runner de tests.
 */
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
