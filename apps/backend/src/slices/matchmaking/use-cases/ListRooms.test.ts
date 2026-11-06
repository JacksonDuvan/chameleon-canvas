/**
 * Tests del use-case ListRooms (TDD): fakes, aserciones sobre Result.
 */
import { describe, it, expect } from 'vitest';
import { ListRooms } from './ListRooms';
import { FakeRoomRegistry } from '../../../../test/fakes/FakeRoomRegistry';
import { expectOk, expectErr } from '../../../../test/helpers/result';

describe('ListRooms', () => {
  it('devuelve las salas registradas, las más recientes primero', async () => {
    const registry = new FakeRoomRegistry();
    expectOk(await registry.register({ roomId: 'AAAAA', hostName: 'Vieja' }));
    expectOk(await registry.register({ roomId: 'BBBBB', hostName: 'Nueva' }));
    const rooms = expectOk(await new ListRooms(registry).execute());
    expect(rooms.map((r) => r.roomId)).toEqual(['BBBBB', 'AAAAA']);
  });

  it('lista vacía si no hay salas registradas (Ok [])', async () => {
    const rooms = expectOk(await new ListRooms(new FakeRoomRegistry()).execute());
    expect(rooms).toEqual([]);
  });

  it('Err RegistryError si el registro falla', async () => {
    const registry = new FakeRoomRegistry();
    registry.failNextCalls = 1;
    expectErr(await new ListRooms(registry).execute(), 'RegistryError');
  });

  it('ESTRÉS: 500 salas registradas se listan completas y ordenadas', async () => {
    const registry = new FakeRoomRegistry();
    for (let i = 0; i < 500; i++) {
      expectOk(await registry.register({ roomId: `R${i}`, hostName: `h${i}` }));
    }
    const rooms = expectOk(await new ListRooms(registry).execute());
    expect(rooms.length).toBe(500);
    for (let i = 1; i < rooms.length; i++) {
      expect(rooms[i]!.createdAt).toBeLessThanOrEqual(rooms[i - 1]!.createdAt);
    }
  });
});
