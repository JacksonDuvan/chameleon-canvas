/**
 * Use-case ChangeColor — procesa la absorción de color del cuentagotas. El cliente
 * samplea el color del entorno (raycast visual) y envía el ColorRGBA resultante; el
 * servidor VALIDA (fase Prep, bloqueo anti-spam) y lo aplica de forma autoritativa.
 *
 * Skills: `authoritative-netcode` (el servidor valida la intención del cliente) +
 * `hexagonal-vertical-slicing` (Result, DI).
 */
import { Ok, Err, type Result } from '@shared/result';
import type { IRoomRepository } from '../domain/ports/IRoomRepository';
import type { ChangeColorError } from '../domain/errors';

export interface ChangeColorCmd {
  readonly roomId: string;
  readonly playerId: string;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export class ChangeColor {
  constructor(private readonly rooms: IRoomRepository) {}

  async execute(cmd: ChangeColorCmd): Promise<Result<void, ChangeColorError>> {
    const loaded = await this.rooms.load(cmd.roomId);
    if (!loaded.ok) return Err({ kind: 'StorageError', cause: loaded.error.cause });
    const room = loaded.value;
    if (!room) return Err({ kind: 'RoomNotFound', roomId: cmd.roomId });

    const player = room.world.players.get(cmd.playerId);
    if (!player) return Err({ kind: 'PlayerNotFound', playerId: cmd.playerId });

    // El camuflaje solo ocurre en la Prep Phase.
    if (room.world.phase !== 'prep') return Err({ kind: 'WrongPhase', phase: room.world.phase });
    // Bloqueo anti-spam de recambio de color.
    if (player.colorLockedUntil > room.world.tick) {
      return Err({ kind: 'ColorLocked', until: player.colorLockedUntil });
    }

    player.color.setMut(cmd.r, cmd.g, cmd.b, cmd.a);
    player.colorLockedUntil = room.world.tick + room.world.config.colorLockTicks;

    const saved = await this.rooms.save(room);
    if (!saved.ok) return Err({ kind: 'StorageError', cause: saved.error.cause });
    return Ok(undefined);
  }
}
