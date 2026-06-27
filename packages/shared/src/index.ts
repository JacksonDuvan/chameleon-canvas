/**
 * `@mecha/shared` — Contrato de red compartido entre backend y frontend.
 *
 * Gobernado por `hexagonal-vertical-slicing`: aquí SOLO viven tipos/contratos
 * puros (DTOs que viajan por el WebSocket, esquemas de Hono RPC, ids de
 * protocolo, el patrón Result). NUNCA lógica de juego: las reglas viven en los
 * slices del backend y la simulación determinista en `@mecha/sim`.
 */

export * from './result';
export * from './protocol';
// export * from './rpc/schemas'; // habilitar cuando se definan los esquemas zod (Paso 3)
