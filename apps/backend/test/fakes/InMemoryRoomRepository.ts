/**
 * Fake en memoria de `IRoomRepository` (NO un mock). Implementa el MISMO puerto
 * que producción (LSP): si la firma cambia, este fake deja de compilar.
 * Skills `tdd-testing` + `hexagonal-vertical-slicing`.
 *
 * SCAFFOLD del Paso 1.
 */
import { Ok, type Result } from '@shared/result';
import type {
  IRoomRepository,
  RoomRepoError,
} from '@/slices/gameplay/domain/ports/IRoomRepository';
import type { WorldState } from '@sim/core/entities/WorldState';

export class InMemoryRoomRepository implements IRoomRepository {
  private readonly rooms = new Map<string, WorldState>();

  seed(roomId: string, world: WorldState): void {
    this.rooms.set(roomId, world);
  }

  async load(roomId: string): Promise<Result<WorldState | null, RoomRepoError>> {
    return Ok(this.rooms.get(roomId) ?? null);
  }

  async save(roomId: string, world: WorldState): Promise<Result<void, RoomRepoError>> {
    this.rooms.set(roomId, world);
    return Ok(undefined);
  }
}
