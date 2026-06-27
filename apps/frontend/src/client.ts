/**
 * Cliente Hono RPC tipado de extremo a extremo. `AppType` se importa SOLO como
 * tipo desde el paquete del backend (workspace dep): con verbatimModuleSyntax el
 * import se borra en runtime, así no se filtra código de servidor al bundle.
 *
 * Requiere `strict: true` y `verbatimModuleSyntax: true` (heredados de la base);
 * sin ellos el cliente infiere `any`.
 *
 * Para HTTP de control (crear sala, lobby). El estado de juego en tiempo real va
 * por el WebSocket del DO (ver `features/matchmaking/hooks/useGameSockets.ts`).
 */
import { hc } from 'hono/client';
import type { AppType } from '@mecha/backend';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

export const api = hc<AppType>(API_URL);
