/**
 * Vitest pool-workers (workerd) — infraestructura: Durable Objects, Hono, KV/R2.
 * Hereda bindings y migraciones de wrangler.jsonc.
 *
 * API de @cloudflare/vitest-pool-workers para Vitest 4 (0.16.x): se combinan
 *  - el plugin `cloudflareTest(options)` (provee el módulo virtual `cloudflare:test`
 *    y el bundling del worker de test), y
 *  - `test.pool = cloudflarePool(options)` (el runner sobre workerd).
 * Vitest 4 eliminó `poolOptions` y el subpath `/config`; las opciones van dentro de
 * ambas funciones.
 *
 * WebSockets en DO no soportan aislamiento de storage por archivo: un solo worker +
 * storage compartido. Ver skill `tdd-testing`.
 */
import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';
import tsconfigPaths from 'vite-tsconfig-paths';

const workersOptions = {
  singleWorker: true,
  isolatedStorage: false,
  wrangler: { configPath: './wrangler.jsonc' },
};

export default defineConfig({
  // tsconfigPaths resuelve los alias @/@shared/@sim en el bundle del worker de test.
  plugins: [tsconfigPaths(), cloudflareTest(workersOptions)],
  test: {
    include: ['src/slices/**/infrastructure/entrypoints/**/*.test.ts'],
    pool: cloudflarePool(workersOptions),
  },
});
