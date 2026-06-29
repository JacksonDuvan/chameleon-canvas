/**
 * Endpoints del backend.
 *
 * IMPORTANTE: este archivo NO se llama `client.ts` a propósito — TanStack Start
 * reserva `src/client.{ts,tsx}` como su *client entry* (el que llama a `hydrateRoot`).
 * Poner aquí otra cosa rompía la hidratación (la app se quedaba en el fallback SSR).
 *
 * El juego en TIEMPO REAL va por WebSocket binario (ver
 * `features/matchmaking/hooks/useGameSockets`), NO por Hono RPC. El cliente Hono RPC
 * tipado (`hc<AppType>`) se añadirá para endpoints HTTP de control (pendiente: aislar
 * el grafo de tipos de Workers para no contaminar el typecheck del frontend).
 */
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
export const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8787';
