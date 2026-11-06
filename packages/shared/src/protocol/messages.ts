/**
 * Protocolo de red: identificadores de tipo de mensaje y DTOs de control.
 *
 * Gobernado por `authoritative-netcode` (ver su referencia `wire-format.md`).
 * El camino caliente (snapshots por tick) usará binario compacto/delta
 * (ver `./wire.ts`); JSON se reserva para mensajes de control raros (join,
 * chat, fin de partida).
 *
 * SCAFFOLD del Paso 1 — los tipos concretos se definen en el Paso 3.
 */

/** Mensajes Cliente -> Servidor (intenciones; nunca resultados). */
export const ClientMsg = {
  JOIN: 0,
  INPUT: 1, // UserCommand etiquetado con número de secuencia
  CHANGE_COLOR: 2,
  CHAT: 3,
} as const;
export type ClientMsg = (typeof ClientMsg)[keyof typeof ClientMsg];

/** Mensajes Servidor -> Cliente (autoritativos). */
export const ServerMsg = {
  WELCOME: 0,
  SNAPSHOT: 1, // delta por tick (lastProcessedInput por jugador)
  KEYFRAME: 2, // estado completo para recién unidos / desincronizados
  PHASE_CHANGE: 3, // Lobby | Prep | Hunt
  GAME_OVER: 4,
} as const;
export type ServerMsg = (typeof ServerMsg)[keyof typeof ServerMsg];

/** Fases de ronda (regla de negocio original de Meccha Chameleon). */
export const GamePhase = {
  LOBBY: 'lobby',
  PREP: 'prep',
  HUNT: 'hunt',
  ENDED: 'ended',
} as const;
export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase];

/** Rol del jugador. Un Hider atrapado se convierte en Seeker. */
export const PlayerRole = {
  HIDER: 'hider',
  SEEKER: 'seeker',
} as const;
export type PlayerRole = (typeof PlayerRole)[keyof typeof PlayerRole];

// ── V1-E: mensajes de control de matchmaking (JSON raro, no por tick) ──

/** Jugador del roster difundido (los nombres viven server-side, no en el wire binario). */
export interface RosterPlayer {
  readonly id: string;
  readonly name: string;
  readonly isHost: boolean;
}

/** Mensaje Servidor → Cliente con la lista de jugadores de la sala (lobby). */
export interface RosterMsg {
  readonly type: 'roster';
  readonly hostId: string | null;
  readonly players: readonly RosterPlayer[];
}

/** Respuesta del pre-flight GET /api/rooms/:roomId/status (antes de abrir el WS). */
export interface RoomStatus {
  readonly roomId: string;
  readonly phase: string; // GamePhase como string (el DO la reporta; no se crea sala)
  readonly players: number;
  readonly maxPlayers: number;
  readonly joinable: boolean;
}
