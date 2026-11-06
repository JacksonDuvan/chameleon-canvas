/**
 * Errores de dominio del slice matchmaking (uniones discriminadas tipadas;
 * skill `hexagonal-vertical-slicing`, patrón Result). Los adaptadores convierten
 * fallos de I/O (KV caído) en `RegistryError` antes de cruzar hacia adentro.
 */
export type MatchmakingError =
  | { kind: 'RegistryError'; cause: string }
  /** Todos los códigos generados chocaron con salas existentes (reintentos agotados). */
  | { kind: 'CodeCollision'; attempts: number };
