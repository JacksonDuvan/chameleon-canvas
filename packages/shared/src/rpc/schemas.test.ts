/**
 * Esquemas Zod de Hono RPC (crear sala / resumen de sala). Contrato compartido:
 * el backend los usa con zValidator; el frontend deriva los DTOs con z.infer.
 *
 * V1-E: crear sala solo pide el nombre del host. `maxPlayers`/`whistling`
 * esperan a que exista UI de opciones del lobby (whistling llega con V1-H);
 * aceptarlos e ignorarlos sería un contrato deshonesto.
 */
import { describe, it, expect } from 'vitest';
import { createRoomSchema, roomSummarySchema } from './schemas';

describe('createRoomSchema', () => {
  it('acepta un nombre de host y lo recorta (trim)', () => {
    expect(createRoomSchema.parse({ hostName: '  Ana  ' })).toEqual({ hostName: 'Ana' });
  });

  it('rechaza nombre vacío o solo espacios', () => {
    expect(createRoomSchema.safeParse({ hostName: '' }).success).toBe(false);
    expect(createRoomSchema.safeParse({ hostName: '   ' }).success).toBe(false);
  });

  it('rechaza nombres de más de 24 caracteres (tope de UI)', () => {
    expect(createRoomSchema.safeParse({ hostName: 'x'.repeat(25) }).success).toBe(false);
    expect(createRoomSchema.safeParse({ hostName: 'x'.repeat(24) }).success).toBe(true);
  });
});

describe('roomSummarySchema (listado de salas)', () => {
  it('acepta un resumen válido', () => {
    expect(
      roomSummarySchema.parse({ roomId: '7Q3HB', hostName: 'Ana', createdAt: 1730000000000 }),
    ).toEqual({ roomId: '7Q3HB', hostName: 'Ana', createdAt: 1730000000000 });
  });

  it('rechaza tipos incorrectos (roomId numérico, createdAt string)', () => {
    expect(
      roomSummarySchema.safeParse({ roomId: 7, hostName: 'Ana', createdAt: 1 }).success,
    ).toBe(false);
    expect(
      roomSummarySchema.safeParse({ roomId: '7Q3HB', hostName: 'Ana', createdAt: '1' }).success,
    ).toBe(false);
  });
});
