/**
 * Endpoints del backend.
 *
 * IMPORTANTE: este archivo NO se llama `client.ts` a propósito — TanStack Start
 * reserva `src/client.{ts,tsx}` como su *client entry* (el que llama a `hydrateRoot`).
 * Poner aquí otra cosa rompía la hidratación (la app se quedaba en el fallback SSR).
 *
 * El juego en TIEMPO REAL va por WebSocket binario (ver
 * `features/matchmaking/hooks/useGameSockets`). Para el control HTTP (crear
 * sala / pre-flight de join) usamos el cliente tipado de
 * `features/matchmaking/hooks/api.ts`.
 *
 * NOTA V1-E (deuda resuelta con desviación documentada): el tipado end-to-end
 * con `hc<AppType>` requería importar el grafo de tipos del Worker backend en el
 * programa TS del frontend; sus aliases `@/` colisionan con los propios del
 * frontend y arrastran tipos de `cloudflare:workers`. En su lugar, el contrato
 * vive en los esquemas Zod de `@mecha/shared` (única fuente de verdad) y
 * `api.ts` valida respuestas contra ellos.
 */
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787';
