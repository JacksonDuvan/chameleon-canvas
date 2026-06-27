/**
 * Formato de red BINARIO del camino caliente (snapshots por tick).
 *
 * Skill `authoritative-netcode` (ref. `wire-format.md`) + `workers-memory-optimization`:
 *   - Snapshots DELTA + keyframes periódicos; cuantización (posiciones a punto fijo,
 *     ángulos a 1-2 bytes, color a 1 byte/canal).
 *   - `ArrayBuffer`/`DataView`; buffers de encode/decode POOLEADOS (no asignar por tick).
 *   - JSON solo para control raro (join, chat, fin de partida).
 *
 * SCAFFOLD del Paso 1 — encoders/decoders concretos en el Paso 3.
 */
export const MAX_SNAPSHOT_BYTES = 4096; // dimensionar según jugadores/sala

// TODO(Paso 3): encodeSnapshot(world): Uint8Array (vista sobre buffer reutilizado),
//               decode(data): UserCommand | ControlMsg.
export {};
