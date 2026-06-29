/**
 * Use-case StartGame — el host arranca la ronda (Lobby → Prep). Asigna roles
 * deterministamente (RNG con semilla) vía el kernel compartido. SRP, Result, DI.
 *
 * Skill `hexagonal-vertical-slicing`.
 */
import { Ok, Err, type Result } from '@shared/result';
import type { IRoomRepository } from '../domain/ports/IRoomRepository';
import type { StartGameError } from '../domain/errors';
import { Room } from '../domain/entities/Room';
import { startGame, makeRng } from '@mecha/sim';

const MIN_PLAYERS = 2;

export interface StartGameCmd {
  readonly roomId: string;
  readonly playerId: string; // debe ser el host
}

export class StartGame {
  constructor(private readonly rooms: IRoomRepository) {}

  async execute(cmd: StartGameCmd): Promise<Result<Room, StartGameError>> {
    const loaded = await this.rooms.load(cmd.roomId);
    if (!loaded.ok) return Err({ kind: 'StorageError', cause: loaded.error.cause });
    const room = loaded.value;
    if (!room) return Err({ kind: 'RoomNotFound', roomId: cmd.roomId });

    if (room.hostId !== cmd.playerId) return Err({ kind: 'NotHost', playerId: cmd.playerId });
    if (room.world.phase !== 'lobby') return Err({ kind: 'AlreadyStarted' });
    if (room.world.players.size < MIN_PLAYERS) {
      return Err({ kind: 'NotEnoughPlayers', have: room.world.players.size, need: MIN_PLAYERS });
    }

    // Enhebra el estado del RNG: la asignación de roles lo consume y avanza, así el
    // stream continúa coherente en los ticks posteriores (ProcessTick).
    const rng = makeRng(room.world.rngState);
    startGame(room.world, rng);
    room.world.rngState = rng.getState();

    const saved = await this.rooms.save(room);
    if (!saved.ok) return Err({ kind: 'StorageError', cause: saved.error.cause });
    return Ok(room);
  }
}
