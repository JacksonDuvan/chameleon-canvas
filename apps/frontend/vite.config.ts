/**
 * Vite — TanStack Start desplegado en Cloudflare Workers vía @cloudflare/vite-plugin.
 *
 * Orden de plugins (importa): cloudflare → tanstackStart → react.
 * `viteEnvironment.name: 'ssr'` integra el entorno del Worker con el framework.
 *
 * Los alias (@/@shared/@sim) se declaran EXPLÍCITAMENTE aquí (no vía tsconfig-paths):
 * el tsconfig excluye `src/routes/**` (se tipan tras la codegen de TanStack), y
 * tsconfig-paths no resuelve alias en archivos excluidos. Los alias explícitos
 * funcionan en TODOS los archivos del bundle.
 *
 * No se usan vite-plugin-wasm/top-level-await: `@dimforge/rapier3d-compat` inlinea el
 * WASM (ver packages/sim/src/physics/wasm/README.md).
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
      '@shared': resolve(root, '../../packages/shared/src'),
      '@sim': resolve(root, '../../packages/sim/src'),
    },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact(),
  ],
});
