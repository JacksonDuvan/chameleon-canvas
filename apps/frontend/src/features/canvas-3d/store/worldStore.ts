/**
 * worldStore — store de Zustand VANILLA (fuera de React). Skill `r3f-rendering`.
 *
 * Frontera clave:
 *   - Estado RÁPIDO (entities, serverTick): lo MUTA la red/predicción a tick rate
 *     y lo LEE `useFrame` vía `worldStore.getState()` o `subscribe` transitorio —
 *     NUNCA con hooks selectores reactivos (re-render por frame = muerte de FPS).
 *   - Estado LENTO (phase, remainingMs, score): seguro de leer reactivamente en el
 *     HUD con un selector, porque cambia rara vez.
 *
 * La escena 3D es un adaptador driven: LEE este store, nunca posee estado de juego
 * (refleja la separación de `hexagonal-vertical-slicing`).
 *
 * SCAFFOLD del Paso 1 — campos y mutadores reales en el Paso 4.
 */
import { createStore } from 'zustand/vanilla';
import type { GamePhase } from '@shared/protocol';
import { Position } from '@sim/core/value-objects/Position';

/** Snapshot recibido de un remoto, para interpolar en el pasado (~100 ms). */
export interface RemoteSnapshot {
  tick: number;
  recvAt: number; // ms (timestamp de recepción en el cliente)
  pos: Position;
}

export interface RemoteEntity {
  readonly id: string;
  buffer: RemoteSnapshot[]; // ring buffer corto para interpolación
  readonly render: Position; // posición interpolada que lee useFrame (se MUTA)
}

export interface WorldStoreState {
  // ── RÁPIDO (tick rate; leer solo desde useFrame) ──
  entities: Map<string, RemoteEntity>;
  localPlayerId: string | null;
  serverTick: number;

  // ── LENTO (presentación; seguro con selector reactivo) ──
  phase: GamePhase;
  remainingMs: number;
}

export const worldStore = createStore<WorldStoreState>(() => ({
  entities: new Map(),
  localPlayerId: null,
  serverTick: 0,
  phase: 'lobby',
  remainingMs: 0,
}));
