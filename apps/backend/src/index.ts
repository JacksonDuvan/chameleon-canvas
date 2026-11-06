/**
 * Punto de entrada del Worker (Hono) y COMPOSITION ROOT de nivel app.
 *
 * Aquí se monta la app Hono, se enruta el upgrade de WebSocket al Durable Object
 * correcto y se exporta el `AppType` que el frontend consume para el tipado RPC
 * end-to-end (`import type { AppType } from '@mecha/backend'`).
 *
 * Skills: `hexagonal-vertical-slicing` (entrypoint fino; cero reglas de juego
 * aquí; cableo de adaptadores→use-cases SOLO aquí) + `authoritative-netcode`
 * (el Worker es la puerta sin estado; el estado vive en el DO).
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '@/shared/env';
import { gameplayRoutes } from '@/slices/gameplay/infrastructure/entrypoints/routes';
import {
  matchmakingRoutes,
  type MatchmakingDeps,
} from '@/slices/matchmaking/infrastructure/entrypoints/routes';
import { CreateRoom } from '@/slices/matchmaking/use-cases/CreateRoom';
import { ListRooms } from '@/slices/matchmaking/use-cases/ListRooms';
import { KvRoomRegistry } from '@/slices/matchmaking/infrastructure/adapters/KvRoomRegistry';
import { CryptoRandomSource } from '@/slices/matchmaking/infrastructure/adapters/CryptoRandomSource';

/**
 * Cableo del slice matchmaking (V1-E). FÁBRICA perezosa: el `Env` solo existe en
 * runtime del Worker; los objetos son triviales y el camino es FRÍO (una vez por
 * sala), así que no hay estado global ni pools que gestionar.
 */
const makeMatchmakingDeps = (env: Env): MatchmakingDeps => {
  const registry = new KvRoomRegistry(env.ROOMS_KV);
  return {
    createRoom: new CreateRoom(registry, new CryptoRandomSource()),
    listRooms: new ListRooms(registry),
  };
};

const app = new Hono<{ Bindings: Env }>()
  // CORS para el control HTTP del frontend (crear sala, pre-flight de join): el
  // cliente vive en OTRO origin (dev: :5173 → :8787; prod: dominio propio). Los
  // WebSockets no pasan por CORS. API pública sin cookies ⇒ reflejar el origin.
  .use('*', cors())
  .route('/api/gameplay', gameplayRoutes)
  .route('/api/matchmaking', matchmakingRoutes(makeMatchmakingDeps))
  // Upgrade de WebSocket → enruta a la instancia de DO de esa sala.
  .get('/api/rooms/:roomId/ws', (c) => {
    const id = c.env.GAME_ROOM.idFromName(c.req.param('roomId'));
    const stub = c.env.GAME_ROOM.get(id);
    return stub.fetch(c.req.raw);
  })
  // V1-E — pre-flight del join por código: estado de la sala ANTES de abrir el
  // WebSocket (read-only; evita el reintento infinito si la ronda ya empezó).
  .get('/api/rooms/:roomId/status', (c) => {
    const id = c.env.GAME_ROOM.idFromName(c.req.param('roomId'));
    const stub = c.env.GAME_ROOM.get(id);
    return stub.fetch(c.req.raw);
  });

/** Tipo de la app para Hono RPC. Lo importa el frontend (solo tipo). */
export type AppType = typeof app;

export default app;

// El runtime necesita la clase del Durable Object exportada desde el entry.
export { GameRoomDO } from '@/slices/gameplay/infrastructure/entrypoints/GameRoomDO';
