/**
 * Use-case ListRooms — listado de salas activas (browser de salas), las más
 * recientes primero. Skills: `hexagonal-vertical-slicing` + `tdd-testing`.
 */
import { Ok, type Result } from '@shared/result';
import type { MatchmakingError } from '../domain/errors';
import type { IRoomRegistry, RoomSummary } from '../domain/ports/IRoomRegistry';

export class ListRooms {
  constructor(private readonly registry: IRoomRegistry) {}

  async execute(): Promise<Result<readonly RoomSummary[], MatchmakingError>> {
    const res = await this.registry.list();
    if (!res.ok) return res;
    // Ordena una copia (no muta el array del fake/adaptador — LSP).
    return Ok([...res.value].sort((a, b) => b.createdAt - a.createdAt));
  }
}
