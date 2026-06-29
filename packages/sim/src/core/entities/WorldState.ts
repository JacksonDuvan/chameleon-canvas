/**
 * Estado de la simulación: lo que servidor y cliente deben calcular IDÉNTICO y lo
 * que viaja (cuantizado) en los snapshots. Skills `authoritative-netcode`
 * (estampado con `tick`) + `workers-memory-optimization` (forma fija).
 */
import { PlayerState } from './PlayerState';
import type { GamePhase } from '@shared/protocol';
import { DEFAULT_SIM_CONFIG, type SimConfig } from '../config';

export type GameOutcome = 'none' | 'hiders' | 'seekers';

export class WorldState {
  tick: number;
  phase: GamePhase;
  phaseEndsAtTick: number; // 0 = sin temporizador (Lobby/Ended)
  outcome: GameOutcome;
  seed: number; // semilla original inmutable
  rngState: number; // estado evolutivo del RNG; lo enhebra ProcessTick entre ticks
  readonly players: Map<string, PlayerState>;
  readonly config: SimConfig;

  constructor(seed = 1, config: SimConfig = DEFAULT_SIM_CONFIG) {
    this.tick = 0;
    this.phase = 'lobby';
    this.phaseEndsAtTick = 0;
    this.outcome = 'none';
    this.seed = seed >>> 0;
    this.rngState = this.seed;
    this.players = new Map();
    this.config = config;
  }
}

/** Fábrica del mundo inicial (en Lobby). Úsala en lugar de `new` para legibilidad. */
export function initialWorld(seed = 1, config: SimConfig = DEFAULT_SIM_CONFIG): WorldState {
  return new WorldState(seed, config);
}
