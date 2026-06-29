/**
 * Use-case ProcessTick — avanza la simulación autoritativa exactamente un tick.
 * SRP: solo el avance del bucle. Orquesta el kernel (`@mecha/sim`) y los puertos;
 * devuelve `Result`, no lanza.
 *
 * Skills: `authoritative-netcode` (timestep fijo) + `hexagonal-vertical-slicing`
 * (DI por constructor; depende de interfaces).
 */
import { Ok, Err, type Result } from '@shared/result';
import type { IRoomRepository } from '../domain/ports/IRoomRepository';
import type { ProcessTickError } from '../domain/errors';
import { step, makeRng, type Rng, type IPhysicsWorld } from '@mecha/sim';
import type { UserCommand } from '@shared/protocol';

export interface ProcessTickCmd {
  readonly roomId: string;
  readonly commands: readonly UserCommand[];
  readonly dt: number; // fijo: 1 / tickHz
}

export class ProcessTick {
  // Un único RNG reutilizado (sin asignar uno por tick). Su estado se enhebra desde
  // y hacia `world.rngState`, así avanza correctamente entre ticks y sobrevive a la
  // hibernación (vía persistencia). Si en el futuro `step` consume el RNG, esto ya
  // es determinista; hoy `step` no lo consume.
  private readonly rng: Rng = makeRng(0);

  constructor(
    private readonly rooms: IRoomRepository,
    private readonly physics: IPhysicsWorld,
  ) {}

  async execute(cmd: ProcessTickCmd): Promise<Result<void, ProcessTickError>> {
    const loaded = await this.rooms.load(cmd.roomId);
    if (!loaded.ok) return Err({ kind: 'StorageError', cause: loaded.error.cause });
    const room = loaded.value;
    if (!room) return Err({ kind: 'RoomNotFound', roomId: cmd.roomId });

    this.rng.setState(room.world.rngState);
    step(room.world, cmd.commands, cmd.dt, this.rng, this.physics);
    room.world.rngState = this.rng.getState();

    const saved = await this.rooms.save(room);
    if (!saved.ok) return Err({ kind: 'StorageError', cause: saved.error.cause });
    return Ok(undefined);
  }
}
