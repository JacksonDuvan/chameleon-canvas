/**
 * Esquemas Zod PUROS (sin Hono) compartidos por backend y frontend. El backend los
 * pasa a `zValidator` en sus rutas; el frontend deriva DTOs con `z.infer`. Viven
 * aquí porque son contrato compartido (skill `hexagonal-vertical-slicing`, §"shared").
 *
 * V1-E: crear sala solo pide el nombre del host. `maxPlayers`/`whistling` esperan
 * a que exista UI de opciones del lobby (whistling llega con V1-H); aceptarlos e
 * ignorarlos sería un contrato deshonesto.
 */
import { z } from 'zod';

export const createRoomSchema = z.object({
  hostName: z.string().trim().min(1).max(24),
});
export type CreateRoom = z.infer<typeof createRoomSchema>;

/** Resumen de sala para el listado público (GET /rooms). */
export const roomSummarySchema = z.object({
  roomId: z.string(),
  hostName: z.string(),
  /** ms epoch; lo estampa el adaptador KV (el use-case no usa reloj de pared). */
  createdAt: z.number(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;
