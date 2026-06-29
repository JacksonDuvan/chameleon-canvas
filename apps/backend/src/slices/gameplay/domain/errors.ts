/**
 * Errores de dominio del slice gameplay: uniones discriminadas tipadas (no strings,
 * no `Error` genéricos). El transporte hace `switch` exhaustivo sobre `kind`
 * (apóyate en `assertNever` de `@shared/result`). Skill `hexagonal-vertical-slicing`.
 */

/** Fallo de un puerto de salida (I/O), traducido en el borde a error de dominio. */
export interface StorageError {
  readonly kind: 'StorageError';
  readonly cause: string;
}

export type ProcessTickError = { kind: 'RoomNotFound'; roomId: string } | StorageError;

export type PlayerJoinError =
  | { kind: 'RoomNotFound'; roomId: string }
  | { kind: 'RoomFull'; capacity: number }
  | { kind: 'AlreadyStarted' }
  | { kind: 'AlreadyJoined'; playerId: string }
  | StorageError;

export type ChangeColorError =
  | { kind: 'RoomNotFound'; roomId: string }
  | { kind: 'PlayerNotFound'; playerId: string }
  | { kind: 'WrongPhase'; phase: string } // solo se camufla en Prep Phase
  | { kind: 'ColorLocked'; until: number }
  | StorageError;

export type StartGameError =
  | { kind: 'RoomNotFound'; roomId: string }
  | { kind: 'NotHost'; playerId: string }
  | { kind: 'AlreadyStarted' }
  | { kind: 'NotEnoughPlayers'; have: number; need: number }
  | StorageError;
