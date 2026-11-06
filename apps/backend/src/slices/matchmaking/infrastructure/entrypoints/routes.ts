/**
 * Rutas HTTP del slice matchmaking (adaptador driving). Traducen protocolo
 * (zValidator con los esquemas Zod de `@shared`) y delegan en use-cases; NO
 * contienen reglas de negocio (skill `hexagonal-vertical-slicing`).
 *
 * El encadenado `.post().get()` es lo que permite a Hono RPC inferir los tipos
 * end-to-end; mantenerlo encadenado (no romper en variables sueltas).
 *
 * Los use-cases se reciben por FÁBRICA (env se resuelve solo en runtime del
 * Worker): la composition real vive en `index.ts`; el cableo por-request es de
 * objetos triviales en camino FRÍO (una vez por sala, nunca por tick).
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createRoomSchema } from '@shared/rpc/schemas';
import type { Env } from '@/shared/env';
import type { CreateRoom } from '../../use-cases/CreateRoom';
import type { ListRooms } from '../../use-cases/ListRooms';

export interface MatchmakingDeps {
  readonly createRoom: CreateRoom;
  readonly listRooms: ListRooms;
}

/** 503: el registro (KV) no responde; 500: colisión de códigos agotada (prácticamente imposible). */
function statusFor(kind: string): 503 | 500 {
  return kind === 'RegistryError' ? 503 : 500;
}

export function matchmakingRoutes(makeDeps: (env: Env) => MatchmakingDeps): Hono<{
  Bindings: Env;
}> {
  return new Hono<{ Bindings: Env }>()
    .post('/rooms', zValidator('json', createRoomSchema), async (c) => {
      const { hostName } = c.req.valid('json');
      const res = await makeDeps(c.env).createRoom.execute({ hostName });
      if (res.ok) return c.json({ roomId: res.value.roomId }, 201);
      return c.json({ error: res.error.kind }, statusFor(res.error.kind));
    })
    .get('/rooms', async (c) => {
      const res = await makeDeps(c.env).listRooms.execute();
      if (res.ok) return c.json({ rooms: res.value });
      return c.json({ error: res.error.kind }, statusFor(res.error.kind));
    });
}
