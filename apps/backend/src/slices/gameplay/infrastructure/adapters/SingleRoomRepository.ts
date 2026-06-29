/**
 * Adaptador IN-MEMORY de `IRoomRepository` para el ciclo de vida del Durable Object:
 * mantiene la ÚNICA sala viva del DO en memoria. Los use-cases (PlayerJoin, StartGame,
 * ChangeColor) operan sobre ella sin tocar el storage del DO en cada llamada; el DO
 * persiste a DO storage de forma periódica vía `DoStorageRoomRepository`, no por tick
 * (el bucle a 30 Hz no hace I/O — skills `authoritative-netcode` + `workers-memory-optimization`).
 *
 * Es producción, no un fake de test (aunque su forma se parezca): vive en el borde
 * del DO como la cache autoritativa en memoria de la sala activa.
 */
import { Ok, type Result } from '@shared/result';
import type {
  IRoomRepository,
  RoomRepoError,
} from '@/slices/gameplay/domain/ports/IRoomRepository';
import type { Room } from '@/slices/gameplay/domain/entities/Room';

export class SingleRoomRepository implements IRoomRepository {
  private room: Room | null;

  constructor(room: Room | null = null) {
    this.room = room;
  }

  /** La sala viva en memoria (la usa el bucle del DO directamente). */
  current(): Room | null {
    return this.room;
  }

  set(room: Room): void {
    this.room = room;
  }

  async load(roomId: string): Promise<Result<Room | null, RoomRepoError>> {
    return Ok(this.room && this.room.id === roomId ? this.room : null);
  }

  async save(room: Room): Promise<Result<void, RoomRepoError>> {
    this.room = room;
    return Ok(undefined);
  }
}
