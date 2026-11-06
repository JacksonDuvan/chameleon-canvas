/**
 * Tests del cliente HTTP de matchmaking (lógica PURA fuera de React). El `fetch`
 * se INYECTA (DI): sin red, sin mocking de módulos. Las respuestas se validan
 * contra el contrato Zod de @shared. Skill `tdd-testing` (fakes + Result).
 */
import { describe, it, expect } from 'vitest';
import { createRoom, roomStatus, listRooms } from './api';
import type { RoomStatus } from '@mecha/shared';

type FetchLike = typeof fetch;

/** fetch fake: (url, init) => Response-like JSON con status configurable. */
function jsonResponse(status: number, body: unknown): FetchLike {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as FetchLike;
}

function textResponse(status: number): FetchLike {
  return (async () => new Response('no-json', { status })) as FetchLike;
}

describe('createRoom', () => {
  it('201 ⇒ Ok con el código de sala', async () => {
    const res = await createRoom('Ana', jsonResponse(201, { roomId: '7Q3HB' }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.roomId).toBe('7Q3HB');
  });

  it('valida el cuerpo con el esquema compartido (nombre vacío ⇒ Err, sin llamar a fetch)', async () => {
    let called = 0;
    const res = await createRoom('   ', (async () => {
      called++;
      return new Response();
    }) as FetchLike);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('InvalidName');
    expect(called).toBe(0);
  });

  it('respuesta malformada (sin roomId) ⇒ Err BadResponse', async () => {
    const res = await createRoom('Ana', jsonResponse(201, { oops: true }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('BadResponse');
  });

  it('status de error del servidor ⇒ Err con el código HTTP', async () => {
    const res = await createRoom('Ana', jsonResponse(503, { error: 'RegistryError' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('ServerError');
  });

  it('red caída ⇒ Err Network (nunca lanza)', async () => {
    const res = await createRoom('Ana', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as FetchLike);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('Network');
  });

  it('JSON corrupto ⇒ Err BadResponse (nunca lanza)', async () => {
    const res = await createRoom('Ana', textResponse(201));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('BadResponse');
  });
});

describe('roomStatus (pre-flight del join)', () => {
  const ok: RoomStatus = { roomId: '7Q3HB', phase: 'lobby', players: 0, maxPlayers: 12, joinable: true };

  it('200 ⇒ Ok con el estado validado', async () => {
    const res = await roomStatus('7Q3HB', jsonResponse(200, ok));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.joinable).toBe(true);
  });

  it('estado malformado ⇒ Err BadResponse', async () => {
    const res = await roomStatus('7Q3HB', jsonResponse(200, { phase: 'lobby' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('BadResponse');
  });

  it('red caída ⇒ Err Network', async () => {
    const res = await roomStatus('7Q3HB', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as FetchLike);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('Network');
  });
});

describe('listRooms', () => {
  it('200 ⇒ Ok con las salas validadas', async () => {
    const res = await listRooms(
      jsonResponse(200, { rooms: [{ roomId: '7Q3HB', hostName: 'Ana', createdAt: 1 }] }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toHaveLength(1);
      expect(res.value[0]!.hostName).toBe('Ana');
    }
  });

  it('rooms con entrada corrupta ⇒ Err BadResponse (contrato Zod estricto)', async () => {
    const res = await listRooms(jsonResponse(200, { rooms: [{ roomId: 7 }] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('BadResponse');
  });
});
