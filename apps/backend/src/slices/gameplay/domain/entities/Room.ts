/**
 * Room — AGREGADO de sesión del backend (server-authoritative). Envuelve el
 * `WorldState` compartido de `@mecha/sim` (lo que el cliente predice) y añade lo
 * server-only: identidad, host, config de sala y metadatos de jugador (`roster`).
 *
 * La fase, los temporizadores, las posiciones y los roles viven en `world` porque
 * el cliente los necesita para predecir. La separación está documentada en
 * packages/sim/README.md. Skill `hexagonal-vertical-slicing`.
 */
import { WorldState, initialWorld } from '@mecha/sim';
import type { SimConfig } from '@mecha/sim';
import { Player } from './Player';

export interface RoomConfig {
  readonly maxPlayers: number;
  readonly whistling: boolean; // regla opcional de silbidos (pista sonora)
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = { maxPlayers: 12, whistling: false };

export class Room {
  readonly id: string;
  hostId: string | null;
  readonly config: RoomConfig;
  readonly world: WorldState;
  /** Metadatos por jugador que NO son parte de la simulación predicha. */
  readonly roster: Map<string, Player>;

  constructor(
    id: string,
    config: RoomConfig = DEFAULT_ROOM_CONFIG,
    seed = 1,
    simConfig?: SimConfig,
  ) {
    this.id = id;
    this.hostId = null;
    this.config = config;
    this.world = simConfig ? new WorldState(seed, simConfig) : initialWorld(seed);
    this.roster = new Map();
  }
}
