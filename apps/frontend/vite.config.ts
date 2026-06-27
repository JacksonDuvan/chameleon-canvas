/**
 * Vite — TanStack Start desplegado en Cloudflare Workers vía @cloudflare/vite-plugin.
 *
 * Orden de plugins (importa): tsconfigPaths → cloudflare → tanstackStart → react.
 * `viteEnvironment.name: 'ssr'` integra el entorno del Worker con el framework.
 *
 * Nota: NO se usan vite-plugin-wasm ni vite-plugin-top-level-await porque
 * `@dimforge/rapier3d-compat` inlinea el WASM en base64 (ver
 * packages/sim/src/physics/wasm/README.md).
 *
 * ⚠ VERIFICAR (Paso 1): que el major de Vite case con @cloudflare/vite-plugin y
 * con la versión de @tanstack/react-start instaladas.
 */
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    viteReact(),
  ],
});
