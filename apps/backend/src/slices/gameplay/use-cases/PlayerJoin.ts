/**
 * Use-case PlayerJoin — entrada de un jugador a una sala (en Lobby). Valida cupo y
 * estado, consulta monetización (entitlement) y añade al jugador a la simulación.
 *
 * Skills: `hexagonal-vertical-slicing` (DI; depende de IRoomRepository e
 * IMonetizationService por interfaz; ISP: solo la vista mínima de monetización).
 */
import { Ok, Err, type Result } from '@shared/result';
import type { IRoomRepository } from '../domain/ports/IRoomRepository';
import type { PlayerJoinError } from '../domain/errors';
import { Room } from '../domain/entities/Room';
import { Player } from '../domain/entities/Player';
import { spawnPlayer } from '@mecha/sim';
import type { IMonetizationService } from '@/slices/monetization/domain/ports/IMonetizationService';

export interface PlayerJoinCmd {
  readonly roomId: string;
  readonly playerId: string;
  readonly displayName: string;
}

export class PlayerJoin {
  constructor(
    private readonly rooms: IRoomRepository,
    private readonly monet: IMonetizationService,
  ) {}

  async execute(cmd: PlayerJoinCmd): Promise<Result<Room, PlayerJoinError>> {
    const loaded = await this.rooms.load(cmd.roomId);
    if (!loaded.ok) return Err({ kind: 'StorageError', cause: loaded.error.cause });
    const room = loaded.value;
    if (!room) return Err({ kind: 'RoomNotFound', roomId: cmd.roomId });

    if (room.world.phase !== 'lobby') return Err({ kind: 'AlreadyStarted' });
    if (room.roster.has(cmd.playerId)) {
      return Err({ kind: 'AlreadyJoined', playerId: cmd.playerId });
    }
    if (room.world.players.size >= room.config.maxPlayers) {
      return Err({ kind: 'RoomFull', capacity: room.config.maxPlayers });
    }

    // Monetización (puerto): resuelve si el jugador es Premium Club. No bloquea.
    const entRes = await this.monet.getEntitlement(cmd.playerId);
    const premium = entRes.ok ? entRes.value.premiumClub : false;

    const isHost = room.hostId === null;
    if (isHost) room.hostId = cmd.playerId;
    room.roster.set(cmd.playerId, new Player(cmd.playerId, cmd.displayName, isHost, premium));
    spawnPlayer(room.world, cmd.playerId);

    const saved = await this.rooms.save(room);
    if (!saved.ok) return Err({ kind: 'StorageError', cause: saved.error.cause });
    return Ok(room);
  }
}
