/**
 * Adaptador driven: implementa `IRoomRepository` sobre el storage del Durable
 * Object. Captura las excepciones de I/O en el borde y las convierte en `Err`
 * tipado (el dominio nunca ve try/catch). Skill `hexagonal-vertical-slicing`.
 *
 * SCAFFOLD del Paso 1.
 */
import { Ok, Err, type Result } from '@shared/result';
import type {
  IRoomRepository,
  RoomRepoError,
} from '@/slices/gameplay/domain/ports/IRoomRepository';
import type { WorldState } from '@sim/core/entities/WorldState';
import type { DurableObjectStorage } from '@cloudflare/workers-types';

export class DoStorageRoomRepository implements IRoomRepository {
  constructor(private readonly storage: DurableObjectStorage) {}

  async load(roomId: string): Promise<Result<WorldState | null, RoomRepoError>> {
    try {
      // TODO(Paso 3): deserializar de forma compacta (no JSON del mundo entero).
      const raw = await this.storage.get<WorldState>(`room:${roomId}`);
      return Ok(raw ?? null);
    } catch (e) {
      return Err({ kind: 'StorageUnavailable', cause: String(e) });
    }
  }

  async save(roomId: string, world: WorldState): Promise<Result<void, RoomRepoError>> {
    try {
      await this.storage.put(`room:${roomId}`, world);
      return Ok(undefined);
    } catch (e) {
      return Err({ kind: 'StorageUnavailable', cause: String(e) });
    }
  }
}
