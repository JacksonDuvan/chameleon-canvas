/**
 * Cliente HTTP de matchmaking (V1-E): crear sala, pre-flight de join y listado.
 *
 * Puro y testeable: `fetch` INYECTABLE (DI). Respuestas validadas contra el
 * contrato Zod de `@mecha/shared` (única fuente de verdad backend↔frontend) y
 * errores como `Result` (nunca lanza) — skills `hexagonal-vertical-slicing` +
 * `tdd-testing`.
 */
import { Ok, Err, type Result } from '@shared/result';
import { createRoomSchema, roomSummarySchema, type RoomStatus, type RoomSummary } from '@mecha/shared';
import { API_URL } from '@/endpoints';

/** Errores del cliente HTTP (uniones discriminadas; el UI las traduce a texto). */
export type ApiError =
  | { kind: 'Network' } // fetch falló (backend caído, sin internet)
  | { kind: 'ServerError'; status: number } // respondedió con error HTTP
  | { kind: 'BadResponse' } // 2xx pero el cuerpo no cumple el contrato
  | { kind: 'InvalidName' }; // el nombre no pasa el esquema compartido

type FetchLike = typeof fetch;

async function jsonFetch(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Result<unknown, ApiError>> {
  try {
    const res = await fetchImpl(url, init);
    if (!res.ok) return Err({ kind: 'ServerError', status: res.status });
    try {
      return Ok(await res.json());
    } catch {
      return Err({ kind: 'BadResponse' });
    }
  } catch {
    return Err({ kind: 'Network' });
  }
}

/** POST /api/matchmaking/rooms — crea una sala y devuelve su código. */
export async function createRoom(
  hostName: string,
  fetchImpl: FetchLike = fetch,
): Promise<Result<{ roomId: string }, ApiError>> {
  const body = createRoomSchema.safeParse({ hostName });
  if (!body.success) return Err({ kind: 'InvalidName' });
  const res = await jsonFetch(
    `${API_URL}/api/matchmaking/rooms`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data),
    },
    fetchImpl,
  );
  if (!res.ok) return res;
  const parsed = res.value as { roomId?: unknown };
  if (typeof parsed.roomId !== 'string' || !parsed.roomId) return Err({ kind: 'BadResponse' });
  return Ok({ roomId: parsed.roomId });
}

/** GET /api/rooms/:roomId/status — pre-flight ANTES de abrir el WebSocket. */
export async function roomStatus(
  roomId: string,
  fetchImpl: FetchLike = fetch,
): Promise<Result<RoomStatus, ApiError>> {
  const res = await jsonFetch(
    `${API_URL}/api/rooms/${encodeURIComponent(roomId)}/status`,
    {},
    fetchImpl,
  );
  if (!res.ok) return res;
  // Validación defensiva del cuerpo (contrato RoomStatus).
  const b = res.value as Partial<RoomStatus>;
  if (
    typeof b.roomId !== 'string' ||
    typeof b.phase !== 'string' ||
    typeof b.players !== 'number' ||
    typeof b.maxPlayers !== 'number' ||
    typeof b.joinable !== 'boolean'
  ) {
    return Err({ kind: 'BadResponse' });
  }
  return Ok(b as RoomStatus);
}

/** GET /api/matchmaking/rooms — listado de salas activas. */
export async function listRooms(
  fetchImpl: FetchLike = fetch,
): Promise<Result<RoomSummary[], ApiError>> {
  const res = await jsonFetch(`${API_URL}/api/matchmaking/rooms`, {}, fetchImpl);
  if (!res.ok) return res;
  const parsed = (res.value as { rooms?: unknown }).rooms;
  if (!Array.isArray(parsed)) return Err({ kind: 'BadResponse' });
  const rooms = roomSummarySchema.array().safeParse(parsed);
  if (!rooms.success) return Err({ kind: 'BadResponse' });
  return Ok(rooms.data);
}
