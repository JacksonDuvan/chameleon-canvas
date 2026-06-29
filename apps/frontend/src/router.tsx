/**
 * Router entry de TanStack Start. El plugin de Vite genera `routeTree.gen.ts` a partir
 * de `src/routes/` y lo importa aquí; este archivo crea la instancia del router.
 */
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// TanStack Start invoca `getRouter()` del router entry para construir el router.
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
