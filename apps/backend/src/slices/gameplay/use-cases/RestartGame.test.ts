import { describe, it, expect } from 'vitest';
import { RestartGame } from './RestartGame';
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
  return { repo, restart: new RestartGame(repo) };
}

describe('RestartGame', () => {
  it('el host reinicia una ronda terminada → Lobby limpio', async () => {
    const room = roomWith(4);
    room.world.phase = 'ended';
    room.world.outcome = 'seekers';
    const { restart } = setup(room);

    const out = expectOk(await restart.execute({ roomId: 'r1', playerId: 'p0' }));
    expect(out.world.phase).toBe('lobby');
    expect(out.world.outcome).toBe('none');
    expect([...out.world.players.values()].every((p) => p.role === 'hider')).toBe(true);
  });

  it('Err NotHost si quien reinicia no es el host', async () => {
    const { restart } = setup(roomWith(4));
    expectErr(await restart.execute({ roomId: 'r1', playerId: 'p2' }), 'NotHost');
  });

  it('Err RoomNotFound si la sala no existe', async () => {
    const { restart } = setup(roomWith(4));
    expectErr(await restart.execute({ roomId: 'desconocida', playerId: 'p0' }), 'RoomNotFound');
  });
});
