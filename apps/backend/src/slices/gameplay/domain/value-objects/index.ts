/**
 * Value-objects del dominio gameplay.
 *
 * `Position` y `ColorRGBA` son parte de la simulación COMPARTIDA (cliente predice
 * con ellos), así que su fuente de verdad vive en `@mecha/sim` y se re-exportan
 * aquí por ergonomía del slice. Los value-objects server-only (si surgen) se
 * definen en este directorio. Skill `hexagonal-vertical-slicing`.
 */
export { Position } from '@sim/core/value-objects/Position';
export { ColorRGBA } from '@sim/core/value-objects/ColorRGBA';
