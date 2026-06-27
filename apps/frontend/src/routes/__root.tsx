/**
 * Ruta raíz (TanStack Start sobre TanStack Router, enrutado por archivos).
 * El plugin de Vite genera el árbol de rutas (`routeTree.gen.ts`) a partir de
 * los archivos de `src/routes/`. Aquí solo va composición/layout, NUNCA lógica
 * de juego (skill `hexagonal-vertical-slicing`).
 *
 * SCAFFOLD del Paso 1 — layout real en el Paso 4.
 */
import { createRootRoute, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return <Outlet />;
}
