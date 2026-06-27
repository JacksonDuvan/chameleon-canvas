/**
 * Puerto de salida: persistencia de salas. El dominio define la INTERFAZ; la
 * infraestructura la implementa (DO storage en prod, fake en memoria en tests).
 * DIP en la práctica (skill `hexagonal-vertical-slicing`).
 *
 * SCAFFOLD del Paso 1 — `Room` se modela en el Paso 2.
 */
import { type Result } from '@shared/result';
import type { WorldState } from '@sim/core/entities/WorldState';

export interface RoomRepoError {
  readonly kind: 'StorageUnavailable';
  readonly cause: string;
}

export interface IRoomRepository {
  load(roomId: string): Promise<Result<WorldState | null, RoomRepoError>>;
  save(roomId: string, world: WorldState): Promise<Result<void, RoomRepoError>>;
}
