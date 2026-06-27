/**
 * Punto de entrada del Worker (Hono) y COMPOSITION ROOT de nivel app.
 *
 * Aquí se monta la app Hono, se enruta el upgrade de WebSocket al Durable Object
 * correcto y se exporta el `AppType` que el frontend consume para el tipado RPC
 * end-to-end (`import type { AppType } from '@mecha/backend'`).
 *
 * Skills: `hexagonal-vertical-slicing` (entrypoint fino; cero reglas de juego
 * aquí) + `authoritative-netcode` (el Worker es la puerta sin estado; el estado
 * vive en el DO).
 *
 * SCAFFOLD del Paso 1 — rutas reales y handlers en el Paso 3.
 */
import { Hono } from 'hono';
import type { Env } from '@/shared/env';
import { gameplayRoutes } from '@/slices/gameplay/infrastructure/entrypoints/routes';

const app = new Hono<{ Bindings: Env }>()
  .route('/api/gameplay', gameplayRoutes)
  // Upgrade de WebSocket → enruta a la instancia de DO de esa sala.
  .get('/api/rooms/:roomId/ws', (c) => {
    const id = c.env.GAME_ROOM.idFromName(c.req.param('roomId'));
    const stub = c.env.GAME_ROOM.get(id);
    return stub.fetch(c.req.raw);
  });

/** Tipo de la app para Hono RPC. Lo importa el frontend (solo tipo). */
export type AppType = typeof app;

export default app;

// El runtime necesita la clase del Durable Object exportada desde el entry.
export { GameRoomDO } from '@/slices/gameplay/infrastructure/entrypoints/GameRoomDO';
