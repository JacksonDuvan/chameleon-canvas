/**
 * Puerto de salida: registro de salas ACTIVAS (código → metadatos).
 *
 * El registro existe para LISTAR salas y des-duplicar códigos; la sala misma vive
 * en su Durable Object (`idFromName(roomId)`) y NO se crea aquí: el DO nace
 * perezosamente al primer WebSocket. El TTL de vida en el listado lo decide el
 * adaptador (KV `expirationTtl`), no el dominio.
 *
 * Skill `hexagonal-vertical-slicing`: ISP — solo lo que matchmaking necesita.
 */
import type { Result } from '@shared/result';
import type { MatchmakingError } from '../errors';

/** Metadatos de una sala activa tal como se muestran en el listado. */
export interface RoomSummary {
  readonly roomId: string;
  readonly hostName: string;
  /** ms epoch; lo estampa el adaptador (los use-cases no usan reloj de pared). */
  readonly createdAt: number;
}

/** Datos con los que se registra una sala recién creada (sin tiempo: lo estampa el adapter). */
export interface RoomRegistration {
  readonly roomId: string;
  readonly hostName: string;
}

export interface IRoomRegistry {
  /** ¿Ya existe una sala activa con ese código? (des-duplicación al crear) */
  exists(roomId: string): Promise<Result<boolean, MatchmakingError>>;
  /** Registra una sala activa en el listado. */
  register(meta: RoomRegistration): Promise<Result<void, MatchmakingError>>;
  /** Lista las salas activas (orden no garantizado; lo ordena el use-case). */
  list(): Promise<Result<readonly RoomSummary[], MatchmakingError>>;
}
