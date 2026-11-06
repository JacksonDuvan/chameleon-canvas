/**
 * Use-case CreateRoom — crea una sala: genera un código único (Crockford base32,
 * sin ambiguos), lo des-duplica contra el registro y lo publica en el listado.
 *
 * La sala NO se materializa aquí: nace en su Durable Object al primer WebSocket
 * (`idFromName(roomId)`), así que no hay I/O de DO. La entropía viene del puerto
 * IRandomSource (determinismo del dominio; el código no es estado de simulación).
 *
 * Skills: `hexagonal-vertical-slicing` (DI por constructor, patrón Result, SRP:
 * crear sala es UNA operación) + `tdd-testing`.
 */
import { Ok, Err, type Result } from '@shared/result';
import { roomCodeFromBytes, ROOM_CODE_LENGTH } from '@shared/room';
import type { MatchmakingError } from '../domain/errors';
import type { IRoomRegistry } from '../domain/ports/IRoomRegistry';
import type { IRandomSource } from '../domain/ports/IRandomSource';

export interface CreateRoomCmd {
  readonly hostName: string;
}

export interface CreatedRoom {
  readonly roomId: string;
}

/** Reintentos ante colisión de código. 32^5 ≈ 33M códigos ⇒ 8 intentos bastan de sobra. */
const MAX_CODE_ATTEMPTS = 8;

export class CreateRoom {
  constructor(
    private readonly registry: IRoomRegistry,
    private readonly random: IRandomSource,
  ) {}

  async execute(cmd: CreateRoomCmd): Promise<Result<CreatedRoom, MatchmakingError>> {
    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      const roomId = roomCodeFromBytes(this.random.bytes(ROOM_CODE_LENGTH));
      const exists = await this.registry.exists(roomId);
      if (!exists.ok) return exists; // RegistryError
      if (exists.value) continue; // código ocupado: reintenta
      const registered = await this.registry.register({ roomId, hostName: cmd.hostName });
      if (!registered.ok) return registered; // RegistryError
      return Ok({ roomId });
    }
    return Err({ kind: 'CodeCollision', attempts: MAX_CODE_ATTEMPTS });
  }
}
