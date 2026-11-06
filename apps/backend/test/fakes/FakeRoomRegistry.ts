/**
 * Fake en memoria de IRoomRegistry (skill `tdd-testing`: fakes, no mocks —
 * comportamiento real, sustituible por el adaptador KV gracias a LSP).
 */
import { Ok, Err, type Result } from '@shared/result';
import type {
  IRoomRegistry,
  RoomRegistration,
  RoomSummary,
} from '../../src/slices/matchmaking/domain/ports/IRoomRegistry';
import type { MatchmakingError } from '../../src/slices/matchmaking/domain/errors';

export class FakeRoomRegistry implements IRoomRegistry {
  private readonly rooms = new Map<string, RoomSummary>();
  /** Códigos ocupados que NO se listan (p. ej. sala que caducó del listado). */
  private readonly taken = new Set<string>();
  private clock = 1_000;
  /** Simula un fallo del backend de almacenamiento en las próximas N llamadas. */
  failNextCalls = 0;

  /** Marca un código como ocupado sin registrarlo en el listado. */
  take(roomId: string): void {
    this.taken.add(roomId);
  }

  async exists(roomId: string): Promise<Result<boolean, MatchmakingError>> {
    if (this.failNextCalls-- > 0) return Err({ kind: 'RegistryError', cause: 'kv down' });
    return Ok(this.rooms.has(roomId) || this.taken.has(roomId));
  }

  async register(meta: RoomRegistration): Promise<Result<void, MatchmakingError>> {
    if (this.failNextCalls-- > 0) return Err({ kind: 'RegistryError', cause: 'kv down' });
    this.rooms.set(meta.roomId, {
      roomId: meta.roomId,
      hostName: meta.hostName,
      createdAt: this.clock++,
    });
    return Ok(undefined);
  }

  async list(): Promise<Result<readonly RoomSummary[], MatchmakingError>> {
    if (this.failNextCalls-- > 0) return Err({ kind: 'RegistryError', cause: 'kv down' });
    return Ok([...this.rooms.values()]);
  }
}
