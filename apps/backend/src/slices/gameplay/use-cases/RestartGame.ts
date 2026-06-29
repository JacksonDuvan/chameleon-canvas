/**
 * Use-case RestartGame — el host reinicia la sala a Lobby ("jugar otra vez") tras una
 * ronda (o para abortar la actual). Delega la regla en el kernel (`resetToLobby`).
 * SRP, Result, DI. Skill `hexagonal-vertical-slicing`.
 */
import { Ok, Err, type Result } from '@shared/result';
import type { IRoomRepository } from '../domain/ports/IRoomRepository';
import type { RestartGameError } from '../domain/errors';
import { Room } from '../domain/entities/Room';
import { resetToLobby } from '@mecha/sim';

export interface RestartGameCmd {
  readonly roomId: string;
  readonly playerId: string; // debe ser el host
}

export class RestartGame {
  constructor(private readonly rooms: IRoomRepository) {}

  async execute(cmd: RestartGameCmd): Promise<Result<Room, RestartGameError>> {
    const loaded = await this.rooms.load(cmd.roomId);
    if (!loaded.ok) return Err({ kind: 'StorageError', cause: loaded.error.cause });
    const room = loaded.value;
    if (!room) return Err({ kind: 'RoomNotFound', roomId: cmd.roomId });
    if (room.hostId !== cmd.playerId) return Err({ kind: 'NotHost', playerId: cmd.playerId });

    resetToLobby(room.world);

    const saved = await this.rooms.save(room);
    if (!saved.ok) return Err({ kind: 'StorageError', cause: saved.error.cause });
    return Ok(room);
  }
}
