/**
 * Ruta raíz de TanStack Start. En Start (a diferencia de Router pelado) el root
 * renderiza el DOCUMENTO HTML completo: `<HeadContent/>` inyecta el head y `<Scripts/>`
 * arranca el cliente (sin él la app NUNCA hidrata y se queda en el SSR). Aquí solo va
 * el shell del documento, NUNCA lógica de juego (skill `hexagonal-vertical-slicing`).
 */
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Meccha Chameleon Clone' },
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
