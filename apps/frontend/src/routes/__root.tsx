/**
 * Ruta raíz de TanStack Start. En Start (a diferencia de Router pelado) el root
 * renderiza el DOCUMENTO HTML completo: `<HeadContent/>` inyecta el head y `<Scripts/>`
 * arranca el cliente (sin él la app NUNCA hidrata y se queda en el SSR). Aquí solo va
 * el shell del documento, NUNCA lógica de juego (skill `hexagonal-vertical-slicing`).
 */
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import globalsCssUrl from '@/shared/styles/globals.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Meccha Chameleon Clone' },
    ],
    // Hoja global (sistema visual del HUD, V1-G) vía <link> del head: así el SSR de
    // Start la sirve ANTES de hidratar (sin flash de HUD sin estilo).
    links: [
      { rel: 'stylesheet', href: globalsCssUrl },
      // Favicon inline (SVG): evita el 404 de /favicon.ico sin añadir assets.
      {
        rel: 'icon',
        href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦎</text></svg>",
      },
    ],
  }),
  notFoundComponent: () => (
    <main style={{ font: '16px system-ui, sans-serif', padding: 24 }}>
      <h1>404</h1>
      <p>Ruta no encontrada.</p>
    </main>
  ),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0 }}>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
