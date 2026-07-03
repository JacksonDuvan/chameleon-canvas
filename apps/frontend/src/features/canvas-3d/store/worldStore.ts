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
import { Vec3, PlayerState, DEFAULT_MAP, type GameOutcome, type MapData } from '@mecha/sim';
import type { GamePhase, PlayerRole } from '@mecha/shared';
import type { RevealEntry } from '../hooks/reveal';

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
  camoScore: number; // 0..1 (P0.2; útil para la pantalla de results)
  pose: number; // pose del avatar 0..3 (V1-B)
  aimX: number; // apunte horizontal (para orientar el avatar remoto)
  aimZ: number;
  // ── Caminata (solo presentación; lo muta useFrame): bamboleo de juguete ──
  wobblePhase: number; // fase acumulada del bamboleo
  wobbleAmp: number; // amplitud suavizada 0..1 (≈ velocidad/maxSpeed)
  prevRX: number; // render.x del frame anterior (para estimar velocidad)
  prevRZ: number;
}

export interface WorldStoreState {
  // ── RÁPIDO (tick rate; leer solo desde useFrame) ──
  readonly local: PlayerState; // jugador local PREDICHO
  /** Pos del local ANTES del último predict (para el suavizado visual entre ticks:
   *  la sim va a 30 Hz y el render a 60+; sin esto el avatar "tiembla" al caminar). */
  readonly localPrevPos: Vec3;
  localPredAt: number; // ms (performance.now del último predict)
  readonly remotes: Map<string, RemoteEntity>;
  localPlayerId: string | null;
  serverTick: number;

  // ── LENTO (presentación; seguro con selector reactivo) ──
  phase: GamePhase;
  /** Semilla del mapa de la ronda (mapa ALEATORIO). Cambia una vez por ronda. */
  mapSeed: number;
  /** Mapa generado de la ronda (= generateMap(mapSeed)). Lo LEE el render (Environment)
   *  y la predicción del cliente (colisión idéntica al servidor). Cambia con mapSeed. */
  map: MapData;
  outcome: GameOutcome;
  connected: boolean;
  isHost: boolean; // solo el host puede iniciar la ronda
  localRole: PlayerRole; // rol del jugador local (para el HUD: Hider/Seeker)
  lastError: string | null; // último error de control del servidor (p. ej. NotHost)
  pointerLocked: boolean; // ¿el canvas tiene el ratón capturado? (hint del HUD, V1-C)
  hitPulse: number; // contador: sube cuando el servidor confirma una captura (hit marker)
  // ── Answer-check (V1-F): congelado al ENTRAR en `ended`; null fuera de results ──
  revealList: RevealEntry[] | null; // escondites a revelar (atrapados → supervivientes)
  endedAt: number | null; // ms (performance.now) del inicio del tour
  /** Dónde ATRAPARON a cada uno (un atrapado se vuelve Seeker y se mueve; el reveal
   *  debe mostrar el escondite donde cayó). Lo muta la red; se limpia al reiniciar. */
  readonly catchSpots: Map<string, { x: number; y: number; z: number }>;
}

export const worldStore = createStore<WorldStoreState>(() => ({
  local: new PlayerState('local'),
  localPrevPos: new Vec3(),
  localPredAt: 0,
  remotes: new Map(),
  localPlayerId: null,
  serverTick: 0,
  phase: 'lobby',
  mapSeed: 1,
  map: DEFAULT_MAP,
  outcome: 'none',
  connected: false,
  isHost: false,
  localRole: 'hider',
  lastError: null,
  pointerLocked: false,
  hitPulse: 0,
  revealList: null,
  endedAt: null,
  catchSpots: new Map(),
}));
