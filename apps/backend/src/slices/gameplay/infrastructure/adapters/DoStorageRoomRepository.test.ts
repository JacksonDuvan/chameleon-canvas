/**
 * DoStorageRoomRepository — regresión del BUG de la "sala congelada en el pasado":
 * una sala persistida con un `SimConfig` VIEJO (p. ej. `catchRange: 3` de antes del
 * Paso 7.5) rehidrataba ese config y los disparos a más de 3 m NUNCA atrapaban
 * (cazado por E2E + logs del DO: raySphere t=5.47 pero maxDist=3 → null).
 *
 * Regla: el `SimConfig` es CÓDIGO, no estado — al rehidratar se usa SIEMPRE el del
 * build actual. (Cuando V1-E traiga opciones del host, p. ej. `ammoLimitEnabled`,
 * viajarán en `RoomConfig` server-only, no congelando el SimConfig entero.)
 *
 * También: el snapshot de jugador debe conservar el estado de ronda que ya existe
 * (aimY/pose/ammo/cooldown) — si el DO hiberna a mitad de ronda no se pierden.
 * Fake de storage en memoria (skill `tdd-testing`: fakes, no mocks).
 */
import { describe, expect, it } from 'vitest';
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { DoStorageRoomRepository } from './DoStorageRoomRepository';
import { Room } from '@/slices/gameplay/domain/entities/Room';
import { DEFAULT_SIM_CONFIG, PlayerState } from '@mecha/sim';

/** Storage fake mínimo (get/put) sobre un Map. */
function fakeStorage(): DurableObjectStorage {
  const map = new Map<string, unknown>();
  return {
    get: (key: string) => Promise.resolve(map.get(key)),
    put: (key: string, value: unknown) => {
      map.set(key, structuredClone(value));
      return Promise.resolve();
    },
  } as unknown as DurableObjectStorage;
}

describe('DoStorageRoomRepository — rehidratación', () => {
  it('IGNORA el SimConfig persistido: una sala vieja renace con el config del código', async () => {
    const repo = new DoStorageRoomRepository(fakeStorage());
    // Sala creada con un SimConfig OBSOLETO (el catchRange de "toque" pre-7.5).
    const stale = { ...DEFAULT_SIM_CONFIG, catchRange: 3, prepDurationTicks: 30 };
    const room = new Room('r1', undefined, 1, stale);
    expect((await repo.save(room)).ok).toBe(true);

    const loaded = await repo.load('r1');
    expect(loaded.ok).toBe(true);
    if (!loaded.ok || !loaded.value) throw new Error('no cargó');
    expect(loaded.value.world.config.catchRange).toBe(DEFAULT_SIM_CONFIG.catchRange);
    expect(loaded.value.world.config.prepDurationTicks).toBe(DEFAULT_SIM_CONFIG.prepDurationTicks);
  });

  it('conserva el estado de ronda del jugador: aimY, pose, ammo y cooldown', async () => {
    const repo = new DoStorageRoomRepository(fakeStorage());
    const room = new Room('r2');
    const p = new PlayerState('p1', 'seeker');
    p.aimX = 0.6;
    p.aimY = -0.3;
    p.aimZ = -0.74;
    p.pose = 2;
    p.ammo = 7;
    p.shotCooldownUntil = 123;
    room.world.players.set('p1', p);
    expect((await repo.save(room)).ok).toBe(true);

    const loaded = await repo.load('r2');
    if (!loaded.ok || !loaded.value) throw new Error('no cargó');
    const q = loaded.value.world.players.get('p1')!;
    expect(q.aimY).toBeCloseTo(-0.3, 9);
    expect(q.pose).toBe(2);
    expect(q.ammo).toBe(7);
    expect(q.shotCooldownUntil).toBe(123);
  });
});
