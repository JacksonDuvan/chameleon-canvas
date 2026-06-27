/**
 * Esquemas Zod PUROS (sin Hono) compartidos por backend y frontend. El backend los
 * pasa a `zValidator` en sus rutas; el frontend deriva DTOs con `z.infer`. Viven
 * aquí porque son contrato compartido (skill `hexagonal-vertical-slicing`, §"shared").
 *
 * SCAFFOLD del Paso 1 — esquemas reales (crear sala, join, etc.) en el Paso 3.
 */
import { z } from 'zod';

export const createRoomSchema = z.object({
  hostName: z.string().min(1).max(24),
  maxPlayers: z.number().int().min(2).max(12),
  whistling: z.boolean().default(false), // regla opcional de silbidos
});
export type CreateRoom = z.infer<typeof createRoomSchema>;
