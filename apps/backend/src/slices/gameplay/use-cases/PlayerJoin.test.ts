import { describe, it, expect } from 'vitest';
import { PlayerJoin } from './PlayerJoin';
import { Room } from '../domain/entities/Room';
import { InMemoryRoomRepository } from '../../../../test/fakes/InMemoryRoomRepository';
import { FakeMonetization } from '../../../../test/fakes/FakeMonetization';
import { expectOk, expectErr } from '../../../../test/helpers/result';

function setup() {
  const repo = new InMemoryRoomRepository();
  const monet = new FakeMonetization(['vip']);
  return { repo, join: new PlayerJoin(repo, monet) };
}

describe('PlayerJoin', () => {
  it('el primer jugador entra como host y aparece en la simulación', async () => {
    const { repo, join } = setup();
    repo.seed(new Room('r1'));
    const room = expectOk(
      await join.execute({ roomId: 'r1', playerId: 'p0', displayName: 'Ana' }),
    );
    expect(room.hostId).toBe('p0');
    expect(room.roster.get('p0')!.isHost).toBe(true);
    expect(room.world.players.has('p0')).toBe(true);
  });

  it('marca premium según el entitlement de monetización (puerto)', async () => {
    const { repo, join } = setup();
    repo.seed(new Room('r1'));
    const room = expectOk(
      await join.execute({ roomId: 'r1', playerId: 'vip', displayName: 'Vip' }),
    );
    expect(room.roster.get('vip')!.premium).toBe(true);
  });

  it('Err RoomNotFound si la sala no existe', async () => {
    const { join } = setup();
    expectErr(
      await join.execute({ roomId: 'x', playerId: 'p', displayName: 'p' }),
      'RoomNotFound',
    );
  });

  it('Err RoomFull al alcanzar el cupo', async () => {
    const { repo, join } = setup();
    repo.seed(new Room('r1', { maxPlayers: 1, whistling: false }));
    await join.execute({ roomId: 'r1', playerId: 'p0', displayName: 'a' });
    expectErr(
      await join.execute({ roomId: 'r1', playerId: 'p1', displayName: 'b' }),
      'RoomFull',
    );
  });

  it('Err AlreadyJoined si el mismo id entra dos veces', async () => {
    const { repo, join } = setup();
    repo.seed(new Room('r1'));
    await join.execute({ roomId: 'r1', playerId: 'p0', displayName: 'a' });
    expectErr(
      await join.execute({ roomId: 'r1', playerId: 'p0', displayName: 'a' }),
      'AlreadyJoined',
    );
  });

  it('Err AlreadyStarted si la sala no está en Lobby', async () => {
    const { repo, join } = setup();
    const room = new Room('r1');
    room.world.phase = 'prep';
    repo.seed(room);
    expectErr(
      await join.execute({ roomId: 'r1', playerId: 'p0', displayName: 'a' }),
      'AlreadyStarted',
    );
  });
});
