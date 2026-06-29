/**
 * worldStore — store de Zustand VANILLA (fuera de React). Skill `r3f-rendering`.
 *
 * Frontera clave:
 *   - Estado RÁPIDO (`local`, `remotes`, `serverTick`): lo MUTA la red/predicción a
 *     tick rate y lo LEE `useFrame` vía `worldStore.getState()` o `subscribe`
 *     transitorio. NUNCA con hooks selectores reactivos (re-render por frame = FPS↓).
 *   - Estado LENTO (`phase`, `outcome`, `connected`, `localPlayerId`): se actualiza con
 *     `setState`; es seguro leerlo con un selector reactivo en el HUD.
 *
 * La escena 3D es un adaptador driven: LEE este store, nunca posee estado de juego
 * (refleja la separación de `hexagonal-vertical-slicing`).
 */
import { createStore } from 'zustand/vanilla';
import { Vec3, PlayerState, type GameOutcome } from '@mecha/sim';
import type { GamePhase, PlayerRole } from '@mecha/shared';

/** Snapshot de un remoto para interpolar en el pasado. */
export interface RemoteSnapshot {
  readonly tick: number;
  readonly recvAt: number; // ms (timestamp de recepción en el cliente)
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RemoteEntity {
  readonly id: string;
  readonly buffer: RemoteSnapshot[]; // ring buffer corto para interpolación
  readonly render: Vec3; // posición interpolada que lee useFrame (se MUTA)
  role: PlayerRole;
  frozen: boolean;
  caught: boolean;
  colorPacked: number;
}

export interface WorldStoreState {
  // ── RÁPIDO (tick rate; leer solo desde useFrame) ──
  readonly local: PlayerState; // jugador local PREDICHO
  readonly remotes: Map<string, RemoteEntity>;
  localPlayerId: string | null;
  serverTick: number;

  // ── LENTO (presentación; seguro con selector reactivo) ──
  phase: GamePhase;
  outcome: GameOutcome;
  connected: boolean;
  isHost: boolean; // solo el host puede iniciar la ronda
  localRole: PlayerRole; // rol del jugador local (para el HUD: Hider/Seeker)
  lastError: string | null; // último error de control del servidor (p. ej. NotHost)
}

export const worldStore = createStore<WorldStoreState>(() => ({
  local: new PlayerState('local'),
  remotes: new Map(),
  localPlayerId: null,
  serverTick: 0,
  phase: 'lobby',
  outcome: 'none',
  connected: false,
  isHost: false,
  localRole: 'hider',
  lastError: null,
}));
