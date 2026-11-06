/**
 * Tests de integración de las rutas de matchmaking en el runtime real (workerd)
 * con KV REAL (binding ROOMS_KV de wrangler.jsonc). Cubren la COSTURA HTTP↔KV↔DO:
 * crear sala (código válido y único), validar con zValidator, listar, y el flujo
 * completo "crear por HTTP → unirse por código via WebSocket al DO".
 *
 * Storage compartido entre archivos (singleWorker): los tests no asumen KV vacío;
 * filtran por marcadores propios. Skill `tdd-testing` (nivel 3: costuras).
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
// Imports robustos para pool-workers: rutas relativas / paquetes workspace (los
// aliases @/@shared no siempre se reescriben en los tests de entrypoints).
import app from '../../../../index';
import { isValidRoomCode, ROOM_CODE_LENGTH } from '@mecha/shared';

const JSON_HEADERS = { 'content-type': 'application/json' };

async function createRoom(hostName: string): Promise<Response> {
  return app.request(
    '/api/matchmaking/rooms',
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ hostName }) },
    env,
  );
}

async function createRoomOk(hostName: string): Promise<string> {
  const res = await createRoom(hostName);
  expect(res.status).toBe(201);
  const body = (await res.json()) as { roomId: string };
  expect(isValidRoomCode(body.roomId)).toBe(true);
  return body.roomId;
}

describe('POST /api/matchmaking/rooms (crear sala)', () => {
  it('responde 201 con un código de sala válido (contrato Crockford)', async () => {
    await createRoomOk('host-valid-code');
  });

  it('registra la sala: aparece en GET /rooms con el nombre del host', async () => {
    const roomId = await createRoomOk('host-listed');
    const res = await app.request('/api/matchmaking/rooms', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rooms: { roomId: string; hostName: string; createdAt: number }[];
    };
    const found = body.rooms.find((r) => r.roomId === roomId);
    expect(found).toBeDefined();
    expect(found!.hostName).toBe('host-listed');
    expect(typeof found!.createdAt).toBe('number');
  });

  it('dos salas seguidas obtienen códigos distintos (des-duplicación)', async () => {
    const a = await createRoomOk('host-unique-a');
    const b = await createRoomOk('host-unique-b');
    expect(a).not.toBe(b);
  });

  it('rechaza con 400 un nombre vacío o solo espacios (zValidator)', async () => {
    expect((await createRoom('')).status).toBe(400);
    expect((await createRoom('   ')).status).toBe(400);
  });

  it('rechaza con 400 un body que no es JSON válido', async () => {
    const res = await app.request(
      '/api/matchmaking/rooms',
      { method: 'POST', headers: JSON_HEADERS, body: '{no-json' },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('ESTRÉS: 100 salas creadas en ráfaga ⇒ 100 códigos válidos y únicos', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const res = await createRoom(`host-stress-${i}`);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { roomId: string };
      expect(body.roomId.length).toBe(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(body.roomId)).toBe(true);
      codes.add(body.roomId);
    }
    expect(codes.size).toBe(100);

    // El listado las incluye TODAS (paginación de KV con 100 por página sobrada).
    const listRes = await app.request('/api/matchmaking/rooms', {}, env);
    const body = (await listRes.json()) as { rooms: { hostName: string }[] };
    const mine = body.rooms.filter((r) => r.hostName.startsWith('host-stress-'));
    expect(mine.length).toBe(100);
  });

  it('FLUJO E2E: sala creada por HTTP es unible por código via WebSocket (welcome 101)', async () => {
    // El "dos navegadores entran a la misma sala por código" de V1-E: el código
    // de HTTP debe direccionar el MISMO DO que usarán los clientes WS.
    const roomId = await createRoomOk('host-e2e-join');
    const id = env.GAME_ROOM.idFromName(roomId);
    const stub = env.GAME_ROOM.get(id);
    const res = await stub.fetch(`https://do/api/rooms/${roomId}/ws?name=E2E`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeTruthy();
    res.webSocket!.accept();
    res.webSocket!.close();
  });
});

describe('CORS (el control HTTP viene de otro origin: dev :5173 → prod dominio propio)', () => {
  it('responde al preflight OPTIONS con Access-Control-Allow-Origin (regresión E2E)', async () => {
    const res = await app.request(
      '/api/matchmaking/rooms',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      },
      env,
    );
    expect(res.status).toBeLessThan(400);
    // API pública sin cookies ⇒ `*` (default de hono/cors). Con el header el
    // navegador del RoomForm puede hacer el POST cross-origin (regresión E2E).
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('el POST con Origin refleja el origin (la llamada del RoomForm pasa)', async () => {
    const res = await app.request(
      '/api/matchmaking/rooms',
      {
        method: 'POST',
        headers: { ...JSON_HEADERS, Origin: 'http://localhost:5173' },
        body: JSON.stringify({ hostName: 'cors-check' }),
      },
      env,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('GET /api/rooms/:roomId/status (pre-flight del join por código)', () => {
  it('una sala NUEVA reporta lobby joinable (y el status NO la crea)', async () => {
    const roomId = 'NEWROOM'; // nunca conectado: no debe existir
    const res = await app.request(`/api/rooms/${roomId}/status`, {}, env);
    expect(res.status).toBe(200);
    const st = (await res.json()) as { roomId: string; phase: string; players: number; joinable: boolean };
    expect(st).toEqual({ roomId, phase: 'lobby', players: 0, maxPlayers: 12, joinable: true });

    // Read-only: el status no materializó la sala (sin 'roomId' persistido).
    const id = env.GAME_ROOM.idFromName(roomId);
    const stub = env.GAME_ROOM.get(id);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.get('roomId')).toBeUndefined();
    });
  });

  it('una sala con partida EN CURSO NO es joinable (evita el reintento infinito del 409)', async () => {
    const roomId = 'BUSYROOM';
    // Materializa la sala con un join real (el único camino que crea estado).
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
    const join = await stub.fetch(`https://do/api/rooms/${roomId}/ws?name=Busy`, {
      headers: { Upgrade: 'websocket' },
    });
    join.webSocket!.accept();

    // Envenena la fase como si la ronda hubiera empezado (arranque de host).
    await runInDurableObject(stub, async (instance) => {
      const room = (instance as unknown as { live: { current(): { world: { phase: string } } | null } }).live.current();
      expect(room).not.toBeNull();
      room!.world.phase = 'hunt';
    });

    const res = await app.request(`/api/rooms/${roomId}/status`, {}, env);
    const st = (await res.json()) as { phase: string; joinable: boolean; players: number };
    expect(st.phase).toBe('hunt');
    expect(st.players).toBe(1);
    expect(st.joinable).toBe(false);

    join.webSocket!.close();
  });

  it('una sala con jugadores en LOBBY sigue joinable hasta el cupo', async () => {
    const roomId = 'LOBBYROOM';
    const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));
    const first = await stub.fetch(`https://do/api/rooms/${roomId}/ws?name=A`, {
      headers: { Upgrade: 'websocket' },
    });
    first.webSocket!.accept();
    const res = await app.request(`/api/rooms/${roomId}/status`, {}, env);
    const st = (await res.json()) as { players: number; joinable: boolean };
    expect(st.players).toBe(1);
    expect(st.joinable).toBe(true);
    first.webSocket!.close();
  });
});
