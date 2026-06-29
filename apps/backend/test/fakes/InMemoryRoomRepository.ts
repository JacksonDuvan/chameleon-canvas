/**
 * Fake en memoria de `IRoomRepository` (NO un mock). Implementa el MISMO puerto
 * que producción (LSP). Skills `tdd-testing` + `hexagonal-vertical-slicing`.
 */
import { Ok, type Result } from '@shared/result';
import type {
  IRoomRepository,
  RoomRepoError,
} from '@/slices/gameplay/domain/ports/IRoomRepository';
import type { Room } from '@/slices/gameplay/domain/entities/Room';

export class InMemoryRoomRepository implements IRoomRepository {
  private readonly rooms = new Map<string, Room>();

  seed(room: Room): void {
    this.rooms.set(room.id, room);
  }

  async load(roomId: string): Promise<Result<Room | null, RoomRepoError>> {
    return Ok(this.rooms.get(roomId) ?? null);
  }

  async save(room: Room): Promise<Result<void, RoomRepoError>> {
    this.rooms.set(room.id, room);
    return Ok(undefined);
  }
}
