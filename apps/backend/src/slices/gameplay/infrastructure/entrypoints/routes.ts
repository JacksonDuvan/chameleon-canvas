/**
 * Rutas HTTP del slice gameplay (adaptador driving). Traducen protocolo y delegan
 * en use-cases; NO contienen reglas de juego (skill `hexagonal-vertical-slicing`).
 *
 * El encadenado `.get().post()` es lo que permite a Hono RPC inferir los tipos
 * end-to-end; mantenerlo encadenado (no romper en variables sueltas).
 *
 * SCAFFOLD del Paso 1.
 */
import { Hono } from 'hono';
import type { Env } from '@/shared/env';

export const gameplayRoutes = new Hono<{ Bindings: Env }>().get(
  '/health',
  (c) => c.json({ ok: true, tickHz: c.env.TICK_HZ }),
);
// Crear/listar salas vive en el slice `matchmaking` (V1-E): /api/matchmaking/rooms.
