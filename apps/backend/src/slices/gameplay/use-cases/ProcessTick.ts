/**
 * Use-case ProcessTick — avanza la física/reglas autoritativas exactamente un tick
 * (dt = 1/30). SRP: solo el avance del bucle. Orquesta el dominio (`@sim`) y los
 * puertos; devuelve `Result`, no lanza.
 *
 * Skills: `authoritative-netcode` (timestep fijo) + `hexagonal-vertical-slicing`
 * (DI por constructor; depende de la interfaz `IRoomRepository`) +
 * `workers-memory-optimization` (sin asignaciones en el camino caliente).
 *
 * SCAFFOLD del Paso 1.
 */
import { Ok, type Result } from '@shared/result';
import type { IRoomRepository } from '@/slices/gameplay/domain/ports/IRoomRepository';
import type { ProcessTickError } from '@/slices/gameplay/domain/errors';

export interface ProcessTickCmd {
  readonly roomId: string;
  readonly dt: number; // fijo: 1/30
}

export class ProcessTick {
  constructor(private readonly rooms: IRoomRepository) {} // DI por constructor

  async execute(_cmd: ProcessTickCmd): Promise<Result<void, ProcessTickError>> {
    // TODO(Paso 2/3): cargar sala → vaciar inputs → step(...) → guardar → snapshot.
    void this.rooms;
    return Ok(undefined);
  }
}
