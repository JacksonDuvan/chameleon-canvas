import { describe, it, expect } from 'vitest';
import { StartGame } from './StartGame';
import { Room } from '../domain/entities/Room';
import { spawnPlayer } from '@mecha/sim';
import { InMemoryRoomRepository } from '../../../../test/fakes/InMemoryRoomRepository';
import { expectOk, expectErr } from '../../../../test/helpers/result';

function roomWith(n: number, hostId = 'p0'): Room {
  const room = new Room('r1');
  for (let i = 0; i < n; i++) spawnPlayer(room.world, `p${i}`);
  room.hostId = hostId;
  return room;
}

function setup(room: Room) {
  const repo = new InMemoryRoomRepository();
  repo.seed(room);
  return { repo, start: new StartGame(repo) };
}

describe('StartGame', () => {
  it('el host arranca la ronda → Prep', async () => {
    const { start } = setup(roomWith(4));
    const room = expectOk(await start.execute({ roomId: 'r1', playerId: 'p0' }));
    expect(room.world.phase).toBe('prep');
  });

  it('Err NotHost si quien arranca no es el host', async () => {
    const { start } = setup(roomWith(4));
    expectErr(await start.execute({ roomId: 'r1', playerId: 'p2' }), 'NotHost');
  });

  it('Err NotEnoughPlayers con menos de 2 jugadores', async () => {
    const { start } = setup(roomWith(1));
    expectErr(await start.execute({ roomId: 'r1', playerId: 'p0' }), 'NotEnoughPlayers');
  });

  it('Err AlreadyStarted si ya no está en Lobby', async () => {
    const room = roomWith(4);
    room.world.phase = 'hunt';
    const { start } = setup(room);
    expectErr(await start.execute({ roomId: 'r1', playerId: 'p0' }), 'AlreadyStarted');
  });

  it('el host elige cuántos buscan; el resto se esconde (y siempre queda un Hider)', async () => {
    const count = (room: { world: { players: Map<string, { role: string }> } }): number =>
      [...room.world.players.values()].filter((p) => p.role === 'seeker').length;

    const three = setup(roomWith(6));
    expect(count(expectOk(await three.start.execute({ roomId: 'r1', playerId: 'p0', seekers: 3 })))).toBe(3);

    const tooMany = setup(roomWith(4));
    expect(count(expectOk(await tooMany.start.execute({ roomId: 'r1', playerId: 'p0', seekers: 99 })))).toBe(3);
  });
});
