/**
 * Vitest pool-workers (workerd) — infraestructura: Durable Objects, Hono, KV/R2.
 * Hereda bindings y migraciones de wrangler.jsonc. Requiere Vitest >= 4.1.
 *
 * WebSockets en DO no soportan aislamiento por archivo: correr con
 * `--no-isolate --poolOptions.workers.singleWorker` (ver script `test:do`).
 * Ver skill `tdd-testing` (referencia tooling-setup.md).
 */
import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersProject({
  test: {
    include: ['src/slices/**/infrastructure/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
