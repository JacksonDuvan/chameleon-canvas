/**
 * Puerto de salida: persistencia de salas. El dominio define la INTERFAZ; la
 * infraestructura la implementa (DO storage en prod, fake en memoria en tests).
 * DIP en la práctica (skill `hexagonal-vertical-slicing`).
 */
import { type Result } from '@shared/result';
import type { Room } from '../entities/Room';

export interface RoomRepoError {
  readonly kind: 'StorageUnavailable';
  readonly cause: string;
}

export interface IRoomRepository {
  load(roomId: string): Promise<Result<Room | null, RoomRepoError>>;
  save(room: Room): Promise<Result<void, RoomRepoError>>;
}
