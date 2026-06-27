/**
 * Errores de dominio del slice gameplay: uniones discriminadas tipadas (no strings,
 * no `Error` genéricos). El transporte hace `switch` exhaustivo sobre `kind`
 * (apóyate en `assertNever` de `@shared/result`). Skill `hexagonal-vertical-slicing`.
 *
 * SCAFFOLD del Paso 1 — se ampliará por use-case.
 */
export type ChangeColorError =
  | { kind: 'PlayerNotFound'; playerId: string }
  | { kind: 'ColorLocked'; until: number }
  | { kind: 'WrongPhase'; phase: string }; // solo se camufla en Prep Phase

export type ProcessTickError = { kind: 'RoomNotFound'; roomId: string };

export type PlayerJoinError =
  | { kind: 'RoomFull'; capacity: number }
  | { kind: 'AlreadyStarted' };
